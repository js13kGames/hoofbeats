export function pickup_tail(_pickup, _world) {
	if(_pickup.collector_id == null) return null;
	const _t      = Math.min(1, (_world.now - _pickup.pull_started_at) / _world.config.pickup_pull_seconds);
	const _tail   = Math.max(0, _t - 0.22 * Math.sin(_t * Math.PI)) ** 3;
	const _origin = _pickup.pull_origin;
	const _target = _pickup.pull_target;
	const _d      = { x: _target.x - _origin.x, y: _target.y - _origin.y };
	return {
		x: _origin.x + _d.x * _tail,
		y: _origin.y + _d.y * _tail,
		z: _origin.z + (19 - _origin.z) * _tail
	};
}
