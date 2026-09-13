import { DEFAULT_CONFIG } from './defaults.js';
import { COPY } from '../copy.js';
import { Random } from './random.js';
import { round_spawns } from './spawns.js';
import { random_color, balanced_color, color_count, color_indices, score_rate, orb_angle } from './colors.js';
import { move_actor, wrap_to_arena, offset, distance_squared, angle_delta } from './movement.js';

export class World {
	constructor(_overrides = {}) {
		this.config      = Object.freeze({ ...DEFAULT_CONFIG, ..._overrides });
		this.random      = new Random(this.config.seed);
		this.now         = 0;
		this.real_time   = 0;
		this.round       = 1;
		this.round_phase = this.config.ready_seconds > 0 ? 'ready' : 'playing';
		this.ready_until   = this.config.ready_seconds;
		this.go_until      = 0;
		this.result_inputs = new Map();
		this.round_ends_at = this.config.round_seconds;
		this.results_until = 0;
		this.events        = [];
		this.pickups     = [];
		this.shots       = [];
		this.next_pickup = 0;
		this.actors      = [];
		for(let _id = 0; _id < this.config.actor_count; _id++)
			this.actors.push({
				id: _id,
				name: COPY.pony_name(_id + 1),
				input_kind: 'bot',
				score: 0,
				...this.fresh_actor(),
				ai: { next_think: 0, target_id: null, input: { x: 0, y: 0 } }
			});
		this.spread_actors();
		this.seed_colors();
	}

	position() {
		return {
			x: this.random.range(-this.config.arena_x, this.config.arena_x),
			y: this.random.range(-this.config.arena_y, this.config.arena_y)
		};
	}

	spread_actors() {
		const _positions = round_spawns(this.actors.length, this.config, this.random);
		for(const _actor of this.actors) Object.assign(_actor, _positions[_actor.id]);
	}

	distance(_a, _b) {
		return distance_squared(_a, _b, this.config);
	}

	direction(_a, _b) {
		return offset(_a, _b, this.config);
	}

	action_speed(_actor) {
		return (
			(1 + color_count(_actor.color_mask) * this.config.action_speed_per_color) *
			(_actor.input_kind === 'bot' ? this.config.bot_action_speed_multiplier : 1)
		);
	}

	new_color(_exclude_actor_id = null) {
		if(!this.config.color_balance_strength) return random_color(this.random);
		const _counts    = Array(6).fill(0);
		const count_mask = _mask => {
			for(const _index of color_indices(_mask)) _counts[_index]++;
		};
		for(const _actor of this.actors) if(_actor.id !== _exclude_actor_id) count_mask(_actor.color_mask);
		for(const _pickup of this.pickups) if(_pickup.expires_at > this.now) count_mask(_pickup.color);
		for(const _shot of this.shots) if(_shot.lands_at > this.now) count_mask(_shot.color);
		return balanced_color(this.random, _counts, this.config.color_balance_strength);
	}

	fresh_actor(_exclude_actor_id = null) {
		return {
			...this.position(),
			vx: 0,
			vy: 0,
			facing: this.random.range(-Math.PI, Math.PI),
			color_mask: this.new_color(_exclude_actor_id),
			state: 'free',
			dash_until: 0,
			dash_ready_at: 0,
			dash_speed: this.config.dash_speed,
			bank: 0,
			shot_ready_at: 0,
			last_shot_at: null,
			flattened_until: 0,
			gray_since: null,
			recall_id: null,
			recall_color: null,
			combo_target: null,
			combo_shot: null,
			dash_target: null,
			dash_shot: null,
			dash_recovery_until: 0,
			stunned_until: 0,
			invulnerable_until: this.now + this.config.spawn_grace_seconds
		};
	}

	join_human(_name = COPY.player_name) {
		if(this.actors.filter(_a => _a.input_kind === 'human').length >= this.config.max_humans) return null;
		const _actor = this.actors.find(_a => _a.input_kind === 'bot');
		if(!_actor) return null;
		const _position = { x: _actor.x, y: _actor.y };
		Object.assign(_actor, this.fresh_actor(_actor.id), {
			input_kind: 'human',
			name: String(_name).trim().slice(0, 24) || COPY.player_name,
			score: 0,
			..._position
		});
		return _actor.id;
	}

	emit(_type, _detail = {}) {
		this.events.push({ type: _type, time: this.now, ..._detail });
		if(this.events.length > 256) this.events.shift();
	}

	drain_events() {
		const _events = this.events;
		this.events   = [];
		return _events;
	}

	spawn_color(_position = this.position(), _color = this.new_color(), _velocity = null) {
		const _spilled = Boolean(_velocity);
		this.pickups.push({
			id: this.next_pickup++,
			..._position,
			color: _color,
			vx: _velocity?.x || 0,
			vy: _velocity?.y || 0,
			born_at: this.now,
			z: _spilled ? 19 : 4,
			vz: _spilled ? 100 : 0,
			ready_at: this.now + (_spilled ? this.config.spill_lock_seconds : 0),
			expires_at: _spilled ? this.now + this.config.pickup_lifetime : Infinity,
			spilled: _spilled
		});
		return this.pickups.at(-1);
	}

	seed_colors() {
		this.pickups = [];
		this.shots   = [];
		for(let i = 0; i < this.config.ambient_colors; i++) this.spawn_color();
		this.next_spawn = this.now + this.config.color_spawn_seconds;
	}

	dash(_id) {
		const _actor = this.actors[_id];
		if(
			!_actor ||
			this.round_phase !== 'playing' ||
			this.now < _actor.flattened_until ||
			this.now < _actor.stunned_until
		)
			return false;
		const _target = this.combo_victim(_actor);
		if(this.now < _actor.dash_ready_at && !_target) return false;
		const _action_speed = this.action_speed(_actor);
		_actor.dash_speed = this.config.dash_speed * _action_speed;
		_actor.dash_until = this.now + this.config.dash_seconds / _action_speed;
		_actor.dash_recovery_until = _actor.dash_until + this.config.dash_recovery_seconds / _action_speed;
		_actor.dash_ready_at = this.now + this.config.dash_cooldown / _action_speed;
		// aim once, with velocity lead when the target is already about to recover.
		let _aim = _actor.facing;
		if(_target) {
			const _d      = this.direction(_actor, _target);
			const _speed  = _actor.dash_speed;
			const _travel = Math.hypot(_d.x, _d.y) / _speed;
			const _lead   = Math.max(0, _travel - (_target.stunned_until - this.now));
			_aim = Math.atan2(_d.y + _target.vy * _lead, _d.x + _target.vx * _lead);
		}
		_actor.dash_facing = _actor.facing = _aim;
		_actor.dash_target = _target?.id ?? null;
		_actor.dash_shot = _target ? _actor.combo_shot : null;
		if(_target) {
			_actor.combo_target = null;
			_actor.combo_shot = null;
		} // spend this shot's lock once.
		_actor.vx = Math.cos(_actor.dash_facing) * _actor.dash_speed;
		_actor.vy = Math.sin(_actor.dash_facing) * _actor.dash_speed;
		this.emit('dash', { actor_id: _id });
		return true;
	}

	combo_victim(_actor) {
		const _target = this.actors[_actor.combo_target];
		return _target &&
			_target.stunned_until > this.now &&
			_target.flattened_until <= this.now &&
			_target.invulnerable_until <= this.now &&
			this.distance(_actor, _target) <= this.config.homing_range ** 2
			? _target
			: null;
	}

	shoot(_id) {
		const _actor = this.actors[_id];
		if(
			!_actor ||
			this.round_phase !== 'playing' ||
			!_actor.color_mask ||
			_actor.flattened_until > this.now ||
			_actor.stunned_until > this.now ||
			_actor.shot_ready_at > this.now ||
			(_actor.dash_until <= this.now && _actor.dash_recovery_until > this.now)
		)
			return false;
		const _index = color_indices(_actor.color_mask).sort(
			(_a, _b) =>
				Math.abs(angle_delta(_actor.facing, orb_angle(_a, this.now, _id, _actor.color_mask))) -
				Math.abs(angle_delta(_actor.facing, orb_angle(_b, this.now, _id, _actor.color_mask)))
		)[0];
		const _color        = 1 << _index;
		const _action_speed = this.action_speed(_actor);
		_actor.color_mask &= ~_color;
		_actor.shot_ready_at = this.now + this.config.shot_cooldown / _action_speed;
		_actor.last_shot_at = this.now;
		if(_actor.input_kind === 'bot') {
			_actor.ai.shot_aim_since = null;
			_actor.ai.input.shoot = false;
		}
		const _shot = {
			id: this.next_pickup++,
			owner_id: _id,
			color: _color,
			x: _actor.x + Math.cos(_actor.facing) * 25,
			y: _actor.y + Math.sin(_actor.facing) * 25,
			vx: Math.cos(_actor.facing) * this.config.shot_speed,
			vy: Math.sin(_actor.facing) * this.config.shot_speed,
			born_at: this.now,
			lands_at: this.now + this.config.shot_seconds
		};
		this.shots.push(_shot);
		if(!_actor.color_mask) {
			_actor.gray_since = this.now;
			_actor.recall_id = _shot.id;
			_actor.recall_color = _color;
		}
		this.emit('shoot', { actor_id: _id });
		return true;
	}

	update_shots(_dt, _actor_starts) {
		this.shots = this.shots.filter(_shot => {
			const _radius =
				this.config.shot_radius *
				(this.actors[_shot.owner_id].input_kind === 'human'
					? this.config.player_reach_multiplier
					: 1);
			const _dx      = _shot.vx * _dt;
			const _dy      = _shot.vy * _dt;
			let _target    = null;
			let _first_hit = Infinity;
			for(const _actor of this.actors) {
				if(
					_actor.id === _shot.owner_id ||
					_actor.flattened_until > this.now ||
					_actor.invulnerable_until > this.now
				)
					continue;
				const _start    = _actor_starts?.get(_actor.id) ?? _actor;
				const _relative = this.direction(_start, _shot);
				const _motion   = this.direction(_start, _actor);
				const _vx       = _dx - _motion.x;
				const _vy       = _dy - _motion.y;
				const _c        = _relative.x ** 2 + _relative.y ** 2 - _radius ** 2;
				const _a            = _vx ** 2 + _vy ** 2;
				const _b            = _relative.x * _vx + _relative.y * _vy;
				const _discriminant = _b * _b - _a * _c;
				// sweep in relative space so moving targets and arena seams count too.
				let _time;
				if(_c < 0) {
					_time = 0;
				} else {
					if(_a > 0 && _discriminant > 0) {
						_time = (-_b - Math.sqrt(_discriminant)) / _a;
					} else {
						_time = Infinity;
					}
				}
				if(_time >= 0 && _time <= 1 && _time < _first_hit) {
					_target = _actor;
					_first_hit = _time;
				}
			}
			_shot.x += _dx * (_target ? _first_hit : 1);
			_shot.y += _dy * (_target ? _first_hit : 1);
			wrap_to_arena(_shot, this.config);
			if(!_target && this.now < _shot.lands_at) return true;
			if(_target) {
				_target.stunned_until = this.now + this.config.stun_seconds;
				_target.state = 'stunned';
				_target.dash_until = this.now;
				_target.vx = _target.vy = 0;
				this.actors[_shot.owner_id].combo_target = _target.id;
				this.actors[_shot.owner_id].combo_shot = { id: _shot.id, color: _shot.color };
				this.emit('stun', { actor_id: _target.id, attacker_id: _shot.owner_id });
			}
			return false;
		});
	}

	hit(_attacker, _victim) {
		if(this.now < _victim.invulnerable_until || this.now < _victim.flattened_until) return false;
		const _setup_shot = _attacker.dash_target === _victim.id ? _attacker.dash_shot : null;
		if(_setup_shot && !(_attacker.color_mask & _setup_shot.color)) {
			// refund the spent setup color as the combo reward.
			const _drop = this.spawn_color({ x: _victim.x, y: _victim.y }, _setup_shot.color, { x: 0, y: 0 });
			_drop.collector_id = null;
			_drop.reserved_for_id = _attacker.id;
		}
		const _colors = color_indices(_victim.color_mask);
		for(let i = 0; i < _colors.length; i++) {
			const _angle = this.random.range(0, Math.PI * 2);
			const _speed = this.random.range(this.config.spill_speed_min, this.config.spill_speed_max);
			const _orbit = orb_angle(_colors[i], this.now, _victim.id, _victim.color_mask);
			const _drop  = this.spawn_color(
				{ x: _victim.x + Math.cos(_orbit) * 31, y: _victim.y + Math.sin(_orbit) * 31 },
				1 << _colors[i],
				{ x: Math.cos(_angle) * _speed, y: Math.sin(_angle) * _speed }
			);
			wrap_to_arena(_drop, this.config);
			_drop.hit_by_id = _attacker.id;
			if(!(_attacker.color_mask & _drop.color)) _drop.reserved_for_id = _attacker.id;
		}
		for(const _drop of this.pickups) {
			if(_drop.reserved_for_id === _victim.id) _drop.reserved_for_id = null;
		}
		_victim.color_mask = 0;
		_victim.flattened_until = this.now + this.config.flatten_seconds;
		_victim.stunned_until = this.now;
		_victim.invulnerable_until = _victim.flattened_until + this.config.invulnerable_seconds;
		_victim.gray_since = null;
		_victim.recall_id = null;
		_victim.combo_target = null;
		_victim.dash_target = null;
		_victim.combo_shot = _victim.dash_shot = null;
		_victim.dash_until = this.now;
		_victim.dash_recovery_until = 0;
		_victim.vx = _victim.vy = 0;
		_victim.state = 'flattened';
		_attacker.dash_ready_at = this.now;
		_attacker.dash_recovery_until = 0;
		_attacker.dash_target = _attacker.combo_target = null;
		_attacker.dash_shot = _attacker.combo_shot = null;
		this.award_score(_attacker, this.config.stomp_score);
		this.emit('hit', { actor_id: _victim.id, attacker_id: _attacker.id, colors: _colors.length });
		return true;
	}

	ricochet(_a, _b) {
		const _distance = Math.sqrt(this.distance(_a, _b));
		const _delta    = this.direction(_b, _a);
		const _nx       = _distance > 0.001 ? _delta.x / _distance : -Math.cos(_a.dash_facing);
		const _ny       = _distance > 0.001 ? _delta.y / _distance : -Math.sin(_a.dash_facing);
		for(const [_actor, _sign] of [
			[_a, 1],
			[_b, -1]
		]) {
			const _dot = _actor.vx * _nx + _actor.vy * _ny;
			_actor.vx -= 2 * _dot * _nx;
			_actor.vy -= 2 * _dot * _ny;
			_actor.facing = _actor.dash_facing = Math.atan2(_actor.vy, _actor.vx);
			_actor.dash_target = _actor.combo_target = null;
			_actor.dash_shot = _actor.combo_shot = null;
			_actor.dash_ready_at = this.now;
			_actor.dash_recovery_until = 0;
			const _separation = Math.max(0, this.config.hit_radius - _distance + 1) / 2;
			_actor.x += _nx * _sign * _separation;
			_actor.y += _ny * _sign * _separation;
			wrap_to_arena(_actor, this.config);
		}
		this.emit('ricochet', { actor_id: _a.id, other_id: _b.id });
	}

	bot_input(_actor) {
		const rebuilding = _other =>
			_other &&
			color_count(_other.color_mask) <
				(_other.input_kind === 'human'
					? Math.max(2, this.config.bot_hunt_min_target_colors)
					: this.config.bot_hunt_min_target_colors);
		// drop stale attacks immediately, even between scheduled decisions.
		if(rebuilding(this.actors[_actor.ai.target_id]) || rebuilding(this.actors[_actor.combo_target])) {
			_actor.ai.next_think = 0;
			_actor.combo_target = null;
		}
		if(this.now < _actor.ai.next_think) return _actor.ai.input;
		const _config  = this.config;
		const pressure = _other =>
			_other.input_kind === 'human'
				? _config.bot_human_pressure_by_colors[color_count(_other.color_mask)]
				: 1;
		_actor.ai.next_think =
			this.now + this.random.range(_config.bot_think_min_seconds, _config.bot_think_max_seconds);
		_actor.ai.target_id = null;
		let _target = null;
		let _best   = Infinity;
		const _held = color_count(_actor.color_mask);
		const flee  = (_other, _urgent) => {
			let { x: _x, y: _y } = this.direction(_other, _actor);
			const _length = Math.hypot(_x, _y);
			if(_length < 0.001) {
				_x = -Math.cos(_other.facing);
				_y = -Math.sin(_other.facing);
			} else {
				_x /= _length;
				_y /= _length;
			}
			// turn away before dashing; an old combo must not aim an escape at a rival.
			_actor.combo_target = null;
			return (_actor.ai.input = {
				x: _x,
				y: _y,
				shoot: false,
				dash:
					_urgent &&
					Math.abs(angle_delta(_actor.facing, Math.atan2(_y, _x))) <
						_config.bot_escape_aim_tolerance
			});
		};
		// leave rebuilding ponies alone; incoming dashes still provoke a dodge.
		const _threat = this.actors.find(_other => {
			if(
				_other.id === _actor.id ||
				_other.dash_until <= this.now ||
				this.distance(_actor, _other) >= _config.bot_threat_range ** 2
			)
				return false;
			const _d       = this.direction(_actor, _other);
			const _vx      = _other.vx - _actor.vx;
			const _vy      = _other.vy - _actor.vy;
			const _closing = _d.x * _vx + _d.y * _vy;
			if(_closing >= 0) return false;
			const _time = Math.min(_other.dash_until - this.now, -_closing / (_vx * _vx + _vy * _vy));
			return (
				(_d.x + _vx * _time) ** 2 + (_d.y + _vy * _time) ** 2 < _config.bot_threat_path_radius ** 2
			);
		});
		if(_threat) {
			return flee(_threat, true);
		}
		if(_held >= _config.bot_flee_min_colors) {
			let _nearest  = null;
			let _distance =
				(_config.bot_flee_base_range +
					(_held - _config.bot_flee_min_colors) * _config.bot_flee_range_per_color) **
				2;
			for(const _other of this.actors) {
				if(
					_other.id === _actor.id ||
					_other.flattened_until > this.now ||
					_other.stunned_until > this.now
				)
					continue;
				const _value = this.distance(_actor, _other);
				if(_value < _distance) {
					_nearest = _other;
					_distance = _value;
				}
			}
			if(_nearest) return flee(_nearest, _distance < _config.bot_escape_dash_range ** 2);
		}
		if(_held >= _config.bot_preserve_min_colors) {
			_actor.combo_target = null;
			return (_actor.ai.input = {
				x: Math.cos(_actor.facing),
				y: Math.sin(_actor.facing),
				shoot: false,
				dash: false
			});
		}
		const _can_shoot       = _held > 0 && _held < _config.bot_shoot_below_colors;
		const _can_attack_dash = _held < _config.bot_attack_dash_below_colors;
		const _crowd           = new Map();
		for(const _bot of this.actors) {
			const _colors = color_count(_bot.color_mask);
			if(
				_bot.id === _actor.id ||
				_bot.input_kind !== 'bot' ||
				_bot.ai.target_id == null ||
				_bot.ai.next_think <= this.now ||
				_bot.flattened_until > this.now ||
				_bot.stunned_until > this.now ||
				_colors >= _config.bot_preserve_min_colors
			)
				continue;
			if(
				!(_colors > 0 && _colors < _config.bot_shoot_below_colors) &&
				_colors >= _config.bot_attack_dash_below_colors
			)
				continue;
			_crowd.set(_bot.ai.target_id, (_crowd.get(_bot.ai.target_id) || 0) + 1);
		}
		for(const _other of this.actors) {
			const _count = color_count(_other.color_mask);
			if(
				(!_can_shoot && !_can_attack_dash) ||
				_other.id === _actor.id ||
				rebuilding(_other) ||
				_other.flattened_until > this.now ||
				_other.invulnerable_until > this.now
			)
				continue;
			// strong bounty weighting: collect locally, or hunt a color-rich rival.
			const _pursuers = _crowd.get(_other.id) || 0;
			const _value    =
				(((this.distance(_actor, _other) * _config.bot_hunt_weight) /
					_count ** _config.bot_hunt_target_color_exponent) *
					(_held >= _config.bot_cautious_min_colors
						? _held ** _config.bot_hunt_held_color_exponent
						: 1) *
					(1 + _config.bot_crowd_penalty * _pursuers)) /
				pressure(_other);
			if(_value < _best) {
				_target = _other;
				_best = _value;
			}
		}
		let _hunting = Boolean(_target);
		for(const _pickup of this.pickups) {
			if(
				_actor.color_mask & _pickup.color ||
				_pickup.ready_at > this.now ||
				_pickup.collector_id != null ||
				(_pickup.reserved_for_id != null && _pickup.reserved_for_id !== _actor.id)
			)
				continue;
			const _value = this.distance(_actor, _pickup) * _config.bot_pickup_weight;
			if(_value < _best) {
				_target = _pickup;
				_best = _value;
				_hunting = false;
			}
		}
		_target ||= this.position();
		if(_hunting) _actor.ai.target_id = _target.id;
		const _skill = _hunting ? pressure(_target) : 1;
		if(_hunting && _target.input_kind === 'human') {
			_actor.ai.next_think = this.now + (_actor.ai.next_think - this.now) / _skill;
		}
		const _distance = Math.sqrt(this.distance(_actor, _target));
		const _lead     = _hunting
			? Math.max(
					0,
					Math.min(
						_config.bot_pursuit_lead_seconds * _skill,
						_distance / (_config.move_speed * this.action_speed(_actor))
					) - Math.max(0, _target.stunned_until - this.now)
				)
			: 0;
		const _aim = _hunting
			? { x: _target.x + _target.vx * _lead, y: _target.y + _target.vy * _lead }
			: _target;
		const { x: _dx, y: _dy } = this.direction(_actor, _aim);
		const _length = Math.hypot(_dx, _dy) || 1;
		const _aimed  =
			Math.abs(angle_delta(_actor.facing, Math.atan2(_dy, _dx))) < _config.bot_attack_aim_tolerance;
		const _combo            = this.combo_victim(_actor);
		const _shot_opportunity =
			_can_shoot &&
			_hunting &&
			_aimed &&
			_distance < _config.bot_shot_max_range * _skill &&
			_distance > _config.bot_shot_min_range;
		// react once, then wait for a valid shot rather than restarting on every aim/target change.
		if(_shot_opportunity) _actor.ai.shot_aim_since ??= this.now;
		return (_actor.ai.input = {
			x: _dx / _length,
			y: _dy / _length,
			shoot:
				_shot_opportunity &&
				this.now - _actor.ai.shot_aim_since >= _config.bot_shot_hesitation_seconds,
			dash:
				_can_attack_dash &&
				(Boolean(
					_combo &&
					!rebuilding(_combo) &&
					color_count(_combo.color_mask) >= _config.bot_combo_min_target_colors &&
					this.distance(_actor, _combo) <= (_config.homing_range * pressure(_combo)) ** 2
				) ||
					(_hunting && _aimed && _distance < _config.bot_attack_dash_range * _skill))
		});
	}

	start_next_round() {
		this.round++;
		this.round_phase = this.config.ready_seconds > 0 ? 'ready' : 'playing';
		this.ready_until = this.real_time + this.config.ready_seconds;
		this.go_until    = 0;
		this.result_inputs.clear();
		this.round_ends_at = this.now + this.config.round_seconds;
		// old-round inventories and loot must not bias the fresh round's supply.
		this.pickups = [];
		this.shots   = [];
		for(const _actor of this.actors) _actor.color_mask = 0;
		for(const _actor of this.actors) {
			Object.assign(_actor, this.fresh_actor(), { score: 0 });
			_actor.ai.next_think = 0;
			_actor.ai.target_id = null;
			_actor.ai.shot_aim_since = null;
		}
		this.spread_actors();
		this.seed_colors();
	}

	step(_dt, _inputs = new Map()) {
		// bound travel per collision check, including coarse headless updates.
		if(_dt > 1 / 60 + 1e-9) {
			const _count = Math.ceil(_dt * 60);
			for(let i = 0; i < _count; i++) this.step(_dt / _count, _inputs);
			return;
		}
		if(this.round_phase === 'ready') {
			const _wait = Math.min(_dt, Math.max(0, this.ready_until - this.real_time));
			this.real_time += _wait;
			if(this.real_time + 1e-9 >= this.ready_until) {
				this.round_phase = 'playing';
				this.go_until    = this.real_time + this.config.go_seconds;
				this.emit('round-go');
				if(_dt - _wait > 1e-9) this.step(_dt - _wait, _inputs);
			}
			return;
		}
		if(this.round_phase === 'results') {
			const _remaining = Math.min(_dt, Math.max(0, this.results_until - this.real_time));
			this.real_time += _remaining;
			this.simulate(_remaining * this.config.results_time_scale, this.result_inputs);
			if(this.real_time + 1e-9 >= this.results_until) {
				this.start_next_round();
				if(_dt - _remaining > 1e-9) this.step(_dt - _remaining, _inputs);
			}
			return;
		}
		const _playing_dt = Math.min(_dt, Math.max(0, this.round_ends_at - this.now));
		this.real_time += _playing_dt;
		for(const _actor of this.actors)
			_actor.score +=
				score_rate(_actor.color_mask, this.config) *
				_playing_dt *
				(_actor.input_kind === 'bot' ? this.config.bot_score_rate_multiplier : 1);
		this.simulate(_playing_dt, _inputs);
		if(this.now + 1e-9 >= this.round_ends_at) {
			this.now           = this.round_ends_at;
			this.round_phase   = 'results';
			this.results_until = this.real_time + this.config.results_seconds;
			this.result_inputs = new Map(
				[..._inputs].map(([_id, _input]) => [_id, { x: _input?.x || 0, y: _input?.y || 0 }])
			);
			this.emit('round-end');
			if(_dt - _playing_dt > 1e-9) this.step(_dt - _playing_dt, _inputs);
		}
	}

	simulate(_dt, _inputs) {
		const _old_now = this.now;
		this.now += _dt;
		const _dashing      = [];
		const _actor_starts = new Map(this.actors.map(_actor => [_actor.id, { x: _actor.x, y: _actor.y }]));
		for(const _actor of this.actors) {
			if(_actor.state === 'flattened' && this.now >= _actor.flattened_until) {
				_actor.color_mask = this.new_color(_actor.id);
				_actor.gray_since = null;
				_actor.recall_id = null;
				this.emit('revive', { actor_id: _actor.id });
			}
			_actor.state = 'free';
			if(this.now < _actor.flattened_until) _actor.state = 'flattened';
			else if(this.now < _actor.stunned_until) _actor.state = 'stunned';
			if(_actor.state === 'flattened') continue;
			if(_actor.state === 'stunned') continue;
			const _input = _actor.input_kind === 'bot' ? this.bot_input(_actor) : _inputs.get(_actor.id);
			if(_input?.dash) this.dash(_actor.id, _input);
			if(_input?.shoot) this.shoot(_actor.id);
			if(_actor.dash_until > _old_now) {
				const _dash_dt = Math.min(_dt, _actor.dash_until - _old_now);
				const _target  = this.actors[_actor.dash_target];
				if(_target && (_target.flattened_until > this.now || _target.invulnerable_until > this.now))
					_actor.dash_target = null;
				_actor.vx = Math.cos(_actor.dash_facing) * _actor.dash_speed;
				_actor.vy = Math.sin(_actor.dash_facing) * _actor.dash_speed;
				_actor.x += _actor.vx * _dash_dt;
				_actor.y += _actor.vy * _dash_dt;
				_actor.facing = _actor.dash_facing;
				wrap_to_arena(_actor, this.config);
				_dashing.push(_actor);
			} else if(_actor.dash_recovery_until > _old_now) {
				// a whiff brakes with the horn down and briefly commits your facing.
				_actor.vx *= Math.exp(-24 * _dt);
				_actor.vy *= Math.exp(-24 * _dt);
				_actor.x += _actor.vx * _dt;
				_actor.y += _actor.vy * _dt;
				wrap_to_arena(_actor, this.config);
			} else move_actor(_actor, _input, _dt, this.config, this.action_speed(_actor));
		}
		const _active_dash = new Set(_dashing);
		for(let i = 0; i < this.actors.length; i++)
			for(let j = i + 1; j < this.actors.length; j++) {
				const _a = this.actors[i];
				const _b = this.actors[j];
				if(!_active_dash.has(_a) && !_active_dash.has(_b)) continue;
				let _attacker;
				if(_active_dash.has(_a) && !_active_dash.has(_b)) {
					_attacker = _a;
				} else {
					if(_active_dash.has(_b) && !_active_dash.has(_a)) {
						_attacker = _b;
					} else {
						_attacker = null;
					}
				}
				const _radius =
					this.config.hit_radius *
					(_attacker?.input_kind === 'human' ? this.config.player_reach_multiplier : 1);
				if(
					_a.state === 'flattened' ||
					_b.state === 'flattened' ||
					this.distance(_a, _b) > _radius ** 2
				)
					continue;
				if(_active_dash.has(_a) && _active_dash.has(_b)) {
					const _delta = this.direction(_b, _a);
					if((_a.vx - _b.vx) * _delta.x + (_a.vy - _b.vy) * _delta.y < 0) this.ricochet(_a, _b);
				} else if(_active_dash.has(_a)) this.hit(_a, _b);
				else if(_active_dash.has(_b)) this.hit(_b, _a);
			}
		this.update_shots(_dt, _actor_starts);
		this.pickups = this.pickups.filter(_pickup => {
			if(_pickup.collector_id != null) {
				const _collector = this.actors[_pickup.collector_id];
				if(_collector.state !== 'free') {
					_pickup.collector_id = null;
					_pickup.vx = _pickup.vy = _pickup.vz = 0;
					_pickup.z = 4;
					return true;
				}
				const _t = Math.min(
					1,
					(this.now - _pickup.pull_started_at) / this.config.pickup_pull_seconds
				);
				const _movement = this.direction(_pickup.pull_target, _collector);
				_pickup.pull_target.x += _movement.x;
				_pickup.pull_target.y += _movement.y;
				const _d = {
					x: _pickup.pull_target.x - _pickup.pull_origin.x,
					y: _pickup.pull_target.y - _pickup.pull_origin.y
				};
				const _ease = _t ** 3;
				_pickup.x = _pickup.pull_origin.x + _d.x * _ease;
				_pickup.y = _pickup.pull_origin.y + _d.y * _ease;
				_pickup.z = _pickup.pull_origin.z + (19 - _pickup.pull_origin.z) * _ease;
				wrap_to_arena(_pickup, this.config);
				if(_t < 1) return true;
				this.collect_color(_collector, _pickup);
				return false;
			}
			if(_pickup.expires_at <= this.now) return false;
			_pickup.x += _pickup.vx * _dt;
			_pickup.y += _pickup.vy * _dt;
			_pickup.vx *= Math.exp(-4 * _dt);
			_pickup.vy *= Math.exp(-4 * _dt);
			if(_pickup.z > 4 || _pickup.vz > 0) {
				_pickup.vz -= 600 * _dt;
				_pickup.z += _pickup.vz * _dt;
				if(_pickup.z <= 4) {
					_pickup.z = 4;
					_pickup.vz = Math.abs(_pickup.vz) > 70 ? -_pickup.vz * 0.22 : 0;
				}
			}
			wrap_to_arena(_pickup, this.config);
			if(_pickup.ready_at > this.now) return true;
			// missing colors from a kill belong to its attacker, regardless of pickup range.
			// a stun delays the pull; being flattened releases reservations in hit().
			const _reserved = this.actors[_pickup.reserved_for_id];
			if(_reserved && _reserved.state !== 'free') return true;
			let _collector = _reserved;
			let _nearest   = Infinity;
			if(!_reserved)
				for(const _actor of this.actors) {
					if(_actor.state !== 'free') continue;
					const _distance = this.distance(_actor, _pickup);
					const _radius   =
						this.config.pickup_radius *
						(_actor.input_kind === 'human' ? this.config.player_reach_multiplier : 1);
					if(
						_distance <= _radius ** 2 &&
						(_distance < _nearest || (_distance === _nearest && _actor.id < _collector.id))
					) {
						_collector = _actor;
						_nearest = _distance;
					}
				}
			if(!_collector) return true;
			if(this.distance(_collector, _pickup) > 18 ** 2) {
				_pickup.collector_id = _collector.id;
				_pickup.pull_started_at = this.now;
				_pickup.pull_origin = { x: _pickup.x, y: _pickup.y, z: _pickup.z };
				const _d = this.direction(_pickup, _collector);
				_pickup.pull_target = { x: _pickup.x + _d.x, y: _pickup.y + _d.y };
				return true;
			}
			this.collect_color(_collector, _pickup);
			return false;
		});
		for(const _actor of this.actors) {
			if(_actor.color_mask || _actor.state === 'flattened') {
				_actor.gray_since = null;
				_actor.recall_id = null;
				continue;
			}
			_actor.gray_since ??= this.now;
			if(this.now - _actor.gray_since + 1e-9 < this.config.recovery_seconds) continue;
			if(this.pickups.some(_p => _p.collector_id === _actor.id)) continue;
			_actor.color_mask = _actor.recall_id != null ? _actor.recall_color : this.new_color(_actor.id);
			_actor.gray_since = null;
			_actor.recall_id = null;
			this.emit('recover', { actor_id: _actor.id });
		}
		if(this.now >= this.next_spawn) {
			if(this.pickups.filter(_p => !_p.spilled).length < this.config.ambient_colors)
				this.spawn_color();
			this.next_spawn = this.now + this.config.color_spawn_seconds;
		}
	}

	award_score(_actor, _points) {
		if(this.round_phase !== 'playing') return;
		_actor.score += _points;
	}

	collect_color(_collector, _pickup) {
		_collector.color_mask |= _pickup.color;
		this.award_score(_collector, this.config.pickup_score);
		_collector.gray_since = null;
		_collector.recall_id = null;
		this.emit('pickup', {
			actor_id: _collector.id,
			color: _pickup.color,
			x: _collector.x,
			y: _collector.y
		});
	}
}
