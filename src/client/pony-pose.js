import { UNICORN_VERTICES, UNICORN_HORN_TIP, UNICORN_DASH_HORN_POSITION } from './unicorn-model.js';

export class PonyPoses {
	constructor() {
		this.round  = null;
		this.actors = new Map();
	}

	sample(_actor, _world) {
		if(this.round !== _world.round) {
			this.round = _world.round;
			this.actors.clear();
		}
		const _flat      = _actor.state === 'flattened';
		const _attacking =
			!_flat && (_actor.dash_until > _world.now || _actor.dash_recovery_until > _world.now);
		let _state = this.actors.get(_actor.id);
		if(!_state) {
			_state = {
				time: _world.now,
				attack: 0,
				stride: _actor.id * 1.7,
				speed: 0,
				vx: _actor.vx,
				vy: _actor.vy,
				lean: 0,
				nod: 0
			};
			this.actors.set(_actor.id, _state);
		}
		const _dt = Math.max(0, _world.now - _state.time);
		_state.time = _world.now;
		// about 90% into the straight-ahead pose in 70ms; relax a little more slowly.
		_state.attack += (Number(_attacking) - _state.attack) * (1 - Math.exp(-_dt * (_attacking ? 34 : 18)));
		const _speed = Math.min(1, Math.hypot(_actor.vx, _actor.vy) / _world.config.move_speed);
		const _ease  = 1 - Math.exp(-_dt * 8);
		_state.speed += (_speed - _state.speed) * _ease;
		_state.stride += _dt * _state.speed * 9;
		const _shot_age = _actor.last_shot_at == null ? Infinity : _world.now - _actor.last_shot_at;
		// snap the horn down in 40ms, then ease upright over the next 160ms.
		let _shot_phase;
		if(!_flat && _shot_age >= 0 && _shot_age < 0.2) {
			if(_shot_age < 0.04) {
				_shot_phase = _shot_age / 0.04;
			} else {
				_shot_phase = 1 - (_shot_age - 0.04) / 0.16;
			}
		} else {
			_shot_phase = 0;
		}
		const _shot_pose = _shot_phase * _shot_phase * (3 - 2 * _shot_phase);
		const _attack = Math.max(_state.attack, _shot_pose);
		const _moving = !_flat && _actor.state !== 'stunned' && _speed > 0.015;
		const _motion = _moving ? _state.speed * (1 - _attack) : 0;
		const _cf = Math.cos(_actor.facing);
		const _sf = Math.sin(_actor.facing);
		const _acceleration =
			_dt > 0 ? ((_actor.vx - _state.vx) * _cf + (_actor.vy - _state.vy) * _sf) / _dt : 0;
		if(_dt > 0) {
			_state.vx = _actor.vx;
			_state.vy = _actor.vy;
			_state.lean +=
				(Math.max(-1, Math.min(1, _acceleration / (_world.config.move_speed * 3))) * 0.065 -
					_state.lean) *
				_ease;
		}
		const _cycle = (1 - Math.cos(_state.stride)) / 2;
		const _nod   = _moving ? (1 - Math.cos(_state.stride - 0.45)) * 0.075 * _state.speed : 0;
		_state.nod += (_nod - _state.nod) * _ease;
		if(!_moving) _state.nod = _state.lean = 0;
		const _horn_pose = _attack + (_moving ? _state.nod : 0) * (1 - _attack);
		const _body_lean = _moving ? (_state.lean + _cycle * 0.025 * _state.speed) * (1 - _attack) : 0;
		const _compress  = 1 - _cycle * 0.025 * _motion;
		const _since     = _world.now - _actor.flattened_until;
		// start recovery exactly at the splat size, spring past normal, then settle.
		const _spring =
			_actor.flattened_until > 0 && _since >= 0 && _since < 0.5
				? Math.exp(-_since * 9) * Math.cos(_since * 18) * (1 - _since / 0.5)
				: 0;
		const _wide = _flat ? 2.2 : 1 + 1.2 * _spring;
		const _tall = _flat ? 0.07 : 1 - 0.93 * _spring;
		const _bank = _flat ? 0 : _actor.bank * (1 - _attack);
		const _cb   = Math.cos(_bank);
		const _sb   = Math.sin(_bank);
		return UNICORN_VERTICES.map(([_x, _y, _z], _index) => {
			if(_index === UNICORN_HORN_TIP) {
				const [_tx, _ty, _tz] = UNICORN_DASH_HORN_POSITION;
				_x += (_tx - _x) * _horn_pose;
				_y += (_ty - _y) * _horn_pose;
				_z += (_tz - _z) * _horn_pose;
			}
			// shear/flex above the floor: the four contact vertices stay planted while gliding.
			_y += _z * _body_lean;
			_z *= _compress;
			const _side   = _x * _cb - _z * _sb;
			const _height = (_z * _cb + _x * _sb) * _tall;
			return [
				_cf * _y * _wide - _sf * _side * _wide,
				_sf * _y * _wide + _cf * _side * _wide,
				Math.max(1, _height)
			];
		});
	}
}
