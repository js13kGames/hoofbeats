function billboard(_center, _x, _y, _tilt) {
	return { x: _center.x + _x, y: _center.y + _y * _tilt, z: _center.z - _y * Math.sqrt(1 - _tilt ** 2) };
}

function star(_center, _radius, _tilt, _phase = 0) {
	return {
		center: _center,
		points: Array.from({ length: 11 }, (_, i) => {
			const _angle = -Math.PI / 2 + (i * Math.PI) / 5 + _phase;
			const _r     = _radius * (i % 2 ? 0.42 : 1);
			return billboard(_center, Math.cos(_angle) * _r, Math.sin(_angle) * _r, _tilt);
		})
	};
}

export function impact_star(_actor, _world, _tilt) {
	const _age = _world.now - _actor.flattened_until + _world.config.flatten_seconds;
	if(_actor.state !== 'flattened' || _age < 0 || _age >= 0.16) return;
	const _white = _age >= 0.07;
	return {
		...star({ x: _actor.x, y: _actor.y, z: 18 }, _white ? 37.5 : 43.5, _tilt, _white ? 0.25 : -0.15),
		white: _white
	};
}

export function stun_stars(_actor, _now, _tilt) {
	const _phase = _now * 3;
	return Array.from({ length: 3 }, (_, i) => {
		const _angle  = _phase + (i * Math.PI * 2) / 3;
		const _center = {
			x: _actor.x + Math.cos(_actor.facing) * 16 + Math.cos(_angle) * 20,
			y: _actor.y + Math.sin(_actor.facing) * 16 + Math.sin(_angle) * 20,
			z: 55 + Math.sin(_angle * 2) * 2
		};
		return star(_center, 8, _tilt);
	});
}

export function lock_reticle(_actor, _now, _tilt) {
	const _radius   = 31 + Math.sin(_now * 5) * 1.5;
	const _center   = { x: _actor.x, y: _actor.y, z: 22 };
	const _brackets = [];
	for(const _x of [-1, 1])
		for(const _y of [-1, 1]) {
			_brackets.push(
				[
					[_x * (_radius - 9), _y * _radius],
					[_x * _radius, _y * _radius],
					[_x * _radius, _y * (_radius - 9)]
				].map(([_sx, _sy]) => billboard(_center, _sx, _sy, _tilt))
			);
		}
	return _brackets;
}
