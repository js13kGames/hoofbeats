export function wrap(_value, _half) {
	return _value - Math.floor((_value + _half) / (_half * 2)) * _half * 2;
}

export function offset(_a, _b, _config) {
	return { x: wrap(_b.x - _a.x, _config.arena_x), y: wrap(_b.y - _a.y, _config.arena_y) };
}

export function distance_squared(_a, _b, _config) {
	const _d = offset(_a, _b, _config);
	return _d.x ** 2 + _d.y ** 2;
}

export function wrap_to_arena(_actor, _config) {
	_actor.x = wrap(_actor.x, _config.arena_x);
	_actor.y = wrap(_actor.y, _config.arena_y);
}

export function angle_delta(_from, _to) {
	return Math.atan2(Math.sin(_to - _from), Math.cos(_to - _from));
}

export function move_actor(_actor, _input, _dt, _config, _speed_multiplier = 1) {
	let _x        = Number.isFinite(_input?.x) ? _input.x : 0;
	let _y        = Number.isFinite(_input?.y) ? _input.y : 0;
	const _length = Math.hypot(_x, _y);
	if(_length > 1) {
		_x /= _length;
		_y /= _length;
	}
	const _speed = Math.hypot(_actor.vx, _actor.vy);
	let _turn    = 0;
	if(_length > 0.08) {
		const _delta = angle_delta(_actor.facing, Math.atan2(_y, _x));
		const _limit = _speed < _config.pivot_speed ? Math.PI : _config.turn_speed * _dt;
		_turn = Math.max(-_limit, Math.min(_limit, _delta));
		_actor.facing += _turn;
	}
	const _bank =
		_speed < _config.pivot_speed ? 0 : -Math.max(-1, Math.min(1, _turn / _dt / _config.turn_speed)) * 0.2;
	_actor.bank += (_bank - _actor.bank) * (1 - Math.exp(-_config.bank_response * _dt));
	const _blend        = 1 - Math.exp(-(_length > 0.08 ? _config.acceleration : _config.coast_drag) * _dt);
	const _target_speed = _length > 0.08 ? Math.min(1, _length) * _config.move_speed * _speed_multiplier : 0;
	_actor.vx += (Math.cos(_actor.facing) * _target_speed - _actor.vx) * _blend;
	_actor.vy += (Math.sin(_actor.facing) * _target_speed - _actor.vy) * _blend;
	_actor.x += _actor.vx * _dt;
	_actor.y += _actor.vy * _dt;
	wrap_to_arena(_actor, _config);
}
