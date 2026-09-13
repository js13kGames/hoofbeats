import { distance_squared, wrap_to_arena } from './movement.js';

export function round_spawns(_count, _config, _random) {
	if(!_count) return [];
	let _best          = [];
	let _best_distance = -1;
	for(let _rows = 1; _rows <= _count; _rows++) {
		const _columns = Math.ceil(_count / _rows);
		const _cells   = _rows * _columns;
		for(const _stagger of [0, 0.5]) {
			const _points = Array.from({ length: _count }, (_, i) => {
				const _cell  = Math.floor((i * _cells) / _count);
				const _row   = Math.floor(_cell / _columns);
				const _point = {
					x: (((_cell % _columns) + (_row % 2) * _stagger) * 2 * _config.arena_x) / _columns,
					y: (_row * 2 * _config.arena_y) / _rows
				};
				wrap_to_arena(_point, _config);
				return _point;
			});
			let _nearest = Infinity;
			for(let i = 0; i < _count; i++)
				for(let j = i + 1; j < _count; j++) {
					_nearest = Math.min(_nearest, distance_squared(_points[i], _points[j], _config));
				}
			if(_nearest > _best_distance) {
				_best_distance = _nearest;
				_best = _points;
			}
		}
	}
	const _x = _random.range(-_config.arena_x, _config.arena_x);
	const _y = _random.range(-_config.arena_y, _config.arena_y);
	for(const _point of _best) {
		_point.x += _x;
		_point.y += _y;
		wrap_to_arena(_point, _config);
	}

	for(let i = _best.length - 1; i > 0; i--) {
		const j = _random.int(i + 1);
		[_best[i], _best[j]] = [_best[j], _best[i]];
	}
	return _best;
}
