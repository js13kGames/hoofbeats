import { PALETTE, color_count, color_indices, mixed_color, orb_angle } from '../core/colors.js';
import { pickup_tail } from './pickup-visual.js';
import { lock_reticle, stun_stars, impact_star } from './status-visual.js';
import { PickupPulses } from './pickup-pulses.js';
import { append_trail, trail_style, trim_trail } from './trails.js';
import { UNICORN_FACES } from './unicorn-model.js';
import { PonyPoses } from './pony-pose.js';
import { offset } from '../core/movement.js';
const TAU = Math.PI * 2;

export class Renderer {
	constructor(_canvas) {
		this.canvas       = _canvas;
		this.context      = _canvas.getContext('2d', { alpha: false });
		this.mask         = document.createElement('canvas');
		this.mask_context = this.mask.getContext('2d');
		this.camera_x     = this.camera_y = 0;
		this.tilt         = 0.74;
		this.height_tilt     = Math.sqrt(1 - this.tilt ** 2);
		this.pickup_pulses   = new PickupPulses();
		this.pony_poses      = new PonyPoses();
		this.trails          = new Map();
		this.last_trail_time = -Infinity;
		this.last_round      = null;
		this.resize();
	}

	resize() {
		const _w     = this.canvas.clientWidth || innerWidth;
		const _h     = this.canvas.clientHeight || innerHeight;
		const _ratio = Math.min(0.5, 800 / Math.max(_w, _h));
		this.width   = this.canvas.width = this.mask.width = Math.max(1, Math.round(_w * _ratio));
		this.height  = this.canvas.height = this.mask.height = Math.max(1, Math.round(_h * _ratio));
		this.zoom    = Math.min(this.width / 650, this.height / 530);
		if(this.config)
			this.zoom = Math.max(
				this.zoom,
				this.width / (2 * this.config.arena_x - 256),
				this.height / ((2 * this.config.arena_y - 256) * this.tilt)
			);
	}

	project(_x, _y, _z = 0) {
		return {
			x: this.width / 2 + (_x - this.camera_x) * this.zoom,
			y: this.height / 2 + ((_y - this.camera_y) * this.tilt - _z * this.height_tilt) * this.zoom,
			depth: (_y - this.camera_y) * this.height_tilt + _z * this.tilt
		};
	}

	unproject(_x, _y) {
		const _r = this.canvas.getBoundingClientRect();
		return {
			x: this.camera_x + (((_x - _r.left) / _r.width) * this.width - this.width / 2) / this.zoom,
			y:
				this.camera_y +
				(((_y - _r.top) / _r.height) * this.height - this.height / 2) / this.zoom / this.tilt
		};
	}

	movement(_x, _y) {
		return { x: _x, y: _y };
	}

	near(_p, _origin = { x: this.camera_x, y: this.camera_y }) {
		const _d = offset(_origin, _p, this.config);
		return { ..._p, x: _origin.x + _d.x, y: _origin.y + _d.y };
	}

	visible(_p, _margin = 100) {
		return (
			_p.x > -_margin && _p.y > -_margin && _p.x < this.width + _margin && _p.y < this.height + _margin
		);
	}

	path(_points, _ctx = this.context) {
		_ctx.beginPath();
		_points.forEach((_p, i) => (i ? _ctx.lineTo(_p.x, _p.y) : _ctx.moveTo(_p.x, _p.y)));
	}

	polygon(_points, _color, _ctx = this.context) {
		this.path(_points, _ctx);
		_ctx.closePath();
		_ctx.fillStyle = _color;
		_ctx.fill();
	}

	ring(_x, _y, _r, _color, _z = 0.5, _width = 1.2) {
		const _p   = this.near({ x: _x, y: _y });
		const _q   = this.project(_p.x, _p.y, _z);
		const _ctx = this.context;
		_ctx.beginPath();
		_ctx.ellipse(_q.x, _q.y, _r * this.zoom, _r * this.zoom * this.tilt, 0, 0, TAU);
		_ctx.strokeStyle = _color;
		_ctx.lineWidth = _width * this.zoom;
		_ctx.stroke();
	}

	glow(_x, _y, _z, _color, _radius = 3.5) {
		const _p   = this.near({ x: _x, y: _y });
		const _q   = this.project(_p.x, _p.y, _z);
		const _r   = _radius * this.zoom;
		const _ctx = this.context;
		if(!this.visible(_q)) return;
		const _gradient = _ctx.createRadialGradient(_q.x, _q.y, 0, _q.x, _q.y, _r * 4);
		_gradient.addColorStop(0, _color);
		_gradient.addColorStop(1, _color + '00');
		_ctx.globalCompositeOperation = 'lighter';
		_ctx.globalAlpha = 0.3;
		_ctx.fillStyle = _gradient;
		_ctx.fillRect(_q.x - _r * 4, _q.y - _r * 4, _r * 8, _r * 8);
		_ctx.globalCompositeOperation = 'source-over';
		_ctx.globalAlpha = 1;
		_ctx.fillStyle = _color;
		_ctx.beginPath();
		_ctx.arc(_q.x, _q.y, _r, 0, TAU);
		_ctx.fill();
	}

	ribbon(_a, _b, _color, _alpha, _width = 1) {
		_a = this.near(_a);
		_b = this.near(_b, _a);
		const _p   = this.project(_a.x, _a.y, _a.z);
		const _q   = this.project(_b.x, _b.y, _b.z);
		const _ctx = this.context;
		if(!this.visible(_p) && !this.visible(_q)) return;
		this.path([_p, _q]);
		_ctx.strokeStyle = _color;
		_ctx.globalCompositeOperation = 'lighter';
		for(const [_scale, _opacity] of [
			[8, 0.1],
			[3, 0.3],
			[0.7, 1]
		]) {
			_ctx.globalAlpha = _alpha * _opacity;
			_ctx.lineWidth = _width * _scale * this.zoom;
			_ctx.stroke();
		}
		_ctx.globalAlpha = 1;
		_ctx.globalCompositeOperation = 'source-over';
	}

	pony(_actor, _world) {
		const _center = this.project(_actor.x, _actor.y, 20);
		if(!this.visible(_center)) return;
		const _vertices = this.pony_poses
			.sample(_actor, _world)
			.map(([_x, _y, _z]) => [_actor.x + _x, _actor.y + _y, _z]);
		const _points = _vertices.map(_p => this.project(..._p));
		const _ctx    = this.context;
		const _blink  =
			_actor.color_mask && _actor.invulnerable_until > _world.now && Math.floor(_world.now * 10) % 2;
		let _hex;
		if(_blink) {
			_hex = '#e2dfec';
		} else {
			if(_actor.color_mask) {
				_hex = mixed_color(_actor.color_mask);
			} else {
				_hex = '#505058';
			}
		}
		const _n     = parseInt(_hex.slice(1), 16);
		const _base  = [(_n >> 16) & 255, (_n >> 8) & 255, _n & 255];
		const _faces = UNICORN_FACES.map(_face => ({
			face: _face,
			depth: _face.reduce((_s, i) => _s + _points[i].depth, 0) / _face.length
		})).sort((_a, _b) => _a.depth - _b.depth);
		_ctx.lineJoin = 'round';
		_ctx.lineWidth = 2.5;
		_ctx.strokeStyle = '#fff';
		for(const { face: _face } of _faces) {
			this.polygon(
				_face.map(i => _points[i]),
				'#fff'
			);
			_ctx.stroke();
		}
		for(const { face: _face } of _faces) {
			const [_a, _b, _c] = _face.map(i => _vertices[i]);
			const _ux = _b[0] - _a[0];
			const _uy = _b[1] - _a[1];
			const _uz = _b[2] - _a[2];
			const _vx = _c[0] - _a[0];
			const _vy = _c[1] - _a[1];
			const _vz = _c[2] - _a[2];
			const _nx  = _uy * _vz - _uz * _vy;
			const _ny  = _uz * _vx - _ux * _vz;
			const _nz  = _ux * _vy - _uy * _vx;
			let _shade =
				0.48 +
				0.52 * Math.abs((-0.45 * _nx - 0.65 * _ny + _nz) / (Math.hypot(_nx, _ny, _nz) * 1.275 || 1));
			if(_actor.color_mask === 63) _shade = 0.8 + 0.2 * _shade;
			this.polygon(
				_face.map(i => _points[i]),
				`rgb(${_base.map(_v => Math.round(_v * _shade)).join(',')})`
			);
		}
	}

	pulse(_wave, _world) {
		const _actor = _world.actors[_wave.actor_id];
		if(!_actor) return;
		const _center = this.near(_actor);
		const _origin = this.project(_center.x, _center.y);
		const _ctx    = this.mask_context;
		if(!this.visible(_origin)) return;
		const _points = this.pony_poses
			.sample(_actor, _world)
			.map(([_x, _y, _z]) => ({ x: _x, y: _y * this.tilt - _z * this.height_tilt }));
		const cx        = (Math.min(..._points.map(_p => _p.x)) + Math.max(..._points.map(_p => _p.x))) / 2;
		const cy        = (Math.min(..._points.map(_p => _p.y)) + Math.max(..._points.map(_p => _p.y))) / 2;
		const _expanded = _points.map(_p => ({
			x: _origin.x + (cx + (_p.x - cx) * _wave.scale) * this.zoom,
			y: _origin.y + (cy + (_p.y - cy) * _wave.scale) * this.zoom
		}));
		_ctx.clearRect(0, 0, this.width, this.height);
		_ctx.lineWidth = 2.5;
		_ctx.lineJoin = 'round';
		_ctx.strokeStyle = mixed_color(_wave.color);
		for(const _face of UNICORN_FACES) {
			this.polygon(
				_face.map(i => _expanded[i]),
				_ctx.strokeStyle,
				_ctx
			);
			_ctx.stroke();
		}
		_ctx.globalCompositeOperation = 'destination-out';
		for(const _face of UNICORN_FACES)
			this.polygon(
				_face.map(i => _expanded[i]),
				'#fff',
				_ctx
			);
		_ctx.globalCompositeOperation = 'source-over';
		this.context.globalAlpha = _wave.alpha;
		this.context.drawImage(this.mask, 0, 0);
		this.context.globalAlpha = 1;
	}

	draw(_world, _player_id, _dt) {
		if(this.config !== _world.config) {
			this.config = _world.config;
			this.resize();
		}
		const _player = _world.actors[_player_id];
		const _config = _world.config;
		const _ctx    = this.context;
		this.camera_x = _player.x;
		this.camera_y = _player.y;
		_ctx.fillStyle = '#020308';
		_ctx.fillRect(0, 0, this.width, this.height);
		// static-grid spacing is an exact divisor of the wrapped arena.
		_ctx.strokeStyle = _config.ground_grid_color;
		_ctx.lineWidth = 1;
		const _sx = _config.ground_grid_spacing * this.zoom;
		const _sy = _sx * this.tilt;
		this.path([]);
		for(let _x = (this.width / 2 - this.camera_x * this.zoom) % _sx; _x < this.width; _x += _sx) {
			_ctx.moveTo(_x, 0);
			_ctx.lineTo(_x, this.height);
		}
		for(
			let _y = (this.height / 2 - this.camera_y * this.zoom * this.tilt) % _sy;
			_y < this.height;
			_y += _sy
		) {
			_ctx.moveTo(0, _y);
			_ctx.lineTo(this.width, _y);
		}
		_ctx.stroke();
		if(this.last_round !== _world.round) {
			this.trails.clear();
			this.last_round      = _world.round;
			this.last_trail_time = -Infinity;
		}
		const _sample = _dt > 0 && _world.now - this.last_trail_time >= _config.trail_sample_seconds;
		if(_sample) this.last_trail_time = _world.now;
		const _active_keys = new Set();
		for(const _actor of _world.actors) {
			if(_sample && _actor.dash_until > _world.now) {
				const _key   = `dash:${_actor.id}`;
				const _trail = this.trails.get(_key) || [];
				append_trail(_trail, {
					x: _actor.x,
					y: _actor.y,
					z: _config.dash_trail_height,
					color: mixed_color(_actor.color_mask),
					time: _world.now,
					...trail_style(_config, color_count(_actor.color_mask), true)
				});
				this.trails.set(_key, _trail);
			}
			for(const i of color_indices(_actor.color_mask)) {
				const _key = `${_actor.id}:${i}`;
				_active_keys.add(_key);
				if(_sample) {
					const _style = trail_style(_config, color_count(_actor.color_mask));
					const _side  = (i - 2.5) * _config.trail_lane_spacing * _style.scale;
					const _cf    = Math.cos(_actor.facing);
					const _sf    = Math.sin(_actor.facing);
					const _trail = this.trails.get(_key) || [];
					append_trail(_trail, {
						x: _actor.x - _cf * _config.trail_rear_offset - _sf * _side,
						y: _actor.y - _sf * _config.trail_rear_offset + _cf * _side,
						z: _actor.state === 'flattened' ? 1 : _config.trail_height,
						color: PALETTE[i],
						time: _world.now,
						..._style
					});
					this.trails.set(_key, _trail);
				}
			}
		}
		for(const [_key, _trail] of this.trails) {
			const _emitting = _key.startsWith('dash:')
				? _world.actors[Number(_key.slice(5))].dash_until > _world.now
				: _active_keys.has(_key);
			if(!_emitting) _trail.emitting = false;
			trim_trail(_trail, _world.now, _config);
			if(!_trail.length && !_active_keys.has(_key)) {
				this.trails.delete(_key);
				continue;
			}
			for(let i = 1; i < _trail.length; i++)
				if(!_trail[i].break_before) {
					const _p    = _trail[i];
					const _fade = Math.max(0, 1 - (_world.now - _p.time) / _p.lifetime);
					this.ribbon(
						_trail[i - 1],
						_p,
						_p.color,
						_fade ** _config.trail_fade_exponent * _config.trail_opacity,
						_p.width / 8
					);
				}
		}
		this.ring(_player.x, _player.y, 25, '#8298a3', 0.5, 1.25 / (this.zoom * this.tilt));
		if(_player.state !== 'flattened')
			this.ribbon(
				{ ..._player, z: 0.3 },
				{
					x: _player.x + Math.cos(_player.facing) * 110,
					y: _player.y + Math.sin(_player.facing) * 110,
					z: 0.3
				},
				'#354650',
				0.8,
				0.6 / this.zoom
			);
		for(const _p of _world.pickups) {
			const _color = PALETTE[Math.log2(_p.color)];
			const _tail  = pickup_tail(_p, _world);
			if(_tail) this.ribbon(_tail, _p, _color, 0.9, 2.4);
			else this.ring(_p.x, _p.y, 5, '#354650', 0.3, 1.2);
			this.glow(_p.x, _p.y, _p.z, _color, 4.5);
		}
		for(const _actor of _world.actors.map(_a => this.near(_a)).sort((_a, _b) => _a.y - _b.y)) {
			this.pony(_actor, _world);
			for(const i of color_indices(_actor.color_mask)) {
				const _angle = orb_angle(i, _world.now, _actor.id, _actor.color_mask);
				this.glow(_actor.x + Math.cos(_angle) * 31, _actor.y + Math.sin(_angle) * 31, 19, PALETTE[i]);
			}
			if(_actor.state === 'stunned')
				for(const { center: _center, points: _points } of stun_stars(
					_actor,
					_world.now,
					this.tilt
				)) {
					const _origin = this.near(_center);
					this.polygon(
						_points.map(_p => {
							_p = this.near(_p, _origin);
							return this.project(_p.x, _p.y, _p.z);
						}),
						'#ffe600'
					);
				}
		}
		for(const _shot of _world.shots) {
			const _age = Math.min(0.045, _world.now - _shot.born_at);
			this.ribbon(
				{ x: _shot.x - _shot.vx * _age, y: _shot.y - _shot.vy * _age, z: 20 },
				{ ..._shot, z: 20 },
				'#ffffff',
				0.85,
				0.8
			);
			this.glow(_shot.x, _shot.y, 20, '#ffffff', 5);
		}
		const _target = _world.combo_victim(_player);
		if(_target)
			for(const _bracket of lock_reticle(_target, _world.now, this.tilt))
				for(let i = 1; i < _bracket.length; i++)
					this.ribbon(_bracket[i - 1], _bracket[i], '#a5f4ff', 1, 0.85 / this.zoom);
		for(const _wave of this.pickup_pulses.sample(_world.now, _world.round, _world.pickups))
			this.pulse(_wave, _world);
		for(const _actor of _world.actors) {
			const _flash = impact_star(this.near(_actor), _world, this.tilt);
			if(_flash) {
				this.polygon(
					_flash.points.map(_p => this.project(_p.x, _p.y, _p.z)),
					_flash.white ? '#fff' : '#000'
				);
				_ctx.strokeStyle = _flash.white ? '#000' : '#fff';
				_ctx.lineWidth = 2;
				_ctx.stroke();
			}
		}
	}
}
