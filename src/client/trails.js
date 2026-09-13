import { offset } from '../core/movement.js';

export function trail_style(_config, _colors, _dash = false) {
	const _amount = Math.max(0, Math.min(6, _colors)) / 6;
	const _scale  =
		_config.trail_min_scale + (1 - _config.trail_min_scale) * _amount ** _config.trail_scale_exponent;
	return {
		scale: _scale,
		max_length: (_dash ? _config.dash_trail_max_length : _config.trail_max_length) * _scale,
		lifetime: (_dash ? _config.dash_trail_max_seconds : _config.trail_max_seconds) * _scale,
		width: (_dash ? _config.dash_trail_max_width : _config.trail_max_width) * _scale
	};
}

export function append_trail(_trail, _point) {
	_trail.push({ ..._point, break_before: !_trail.emitting });
	_trail.emitting = true;
}

export function trim_trail(_trail, _now, _config) {
	// expiring a short-lived sample must not delete older, longer-lived samples.
	let _write = 0;
	let _gap   = false;
	for(let i = 0; i < _trail.length; i++) {
		const _point = _trail[i];
		if(_point.lifetime <= 0 || _now - _point.time >= _point.lifetime) {
			_gap = true;
			continue;
		}
		if(_gap) _point.break_before = true;
		_trail[_write++] = _point;
		_gap = false;
	}
	_trail.length = _write;
	if(_gap) _trail.emitting = false;
	const _first = _trail.length - Math.max(0, Math.floor(_config.trail_max_points));
	if(_first > 0) _trail.splice(0, _first);
	if(!_trail.length) return;
	const _max_length = Math.max(..._trail.map(_point => _point.max_length));
	if(_max_length <= 0) {
		_trail.length = 0;
		return;
	}
	let _length = 0;
	for(let i = _trail.length - 1; i > 0; i--) {
		const _newer = _trail[i];
		const _older = _trail[i - 1];
		const _d     = offset(_newer, _older, _config);
		if(_newer.break_before) continue;
		const _dz      = _older.z - _newer.z;
		const _segment = Math.hypot(_d.x, _d.y, _dz);
		if(_length + _segment > _max_length) {
			const _fraction = (_max_length - _length) / _segment;
			_trail[i - 1] = {
				..._older,
				x: _newer.x + _d.x * _fraction,
				y: _newer.y + _d.y * _fraction,
				z: _newer.z + _dz * _fraction,
				time: _newer.time + (_older.time - _newer.time) * _fraction
			};
			_trail.splice(0, i - 1);
			return;
		}
		_length += _segment;
	}
}
