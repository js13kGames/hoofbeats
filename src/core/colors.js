export const PALETTE = Object.freeze(['#ff1800', '#ff8000', '#ffe600', '#00ef32', '#0080ff', '#9000ff']);
export const ALL_COLORS = 63;

export function color_count(_mask) {
	let _count = 0;
	for(; _mask; _mask &= _mask - 1) _count++;
	return _count;
}

export function color_indices(_mask) {
	return [0, 1, 2, 3, 4, 5].filter(i => _mask & (1 << i));
}

export function random_color(_random) {
	return 1 << _random.int(6);
}

export function balanced_color(_random, _counts, _strength) {
	const _average = _counts.reduce((_sum, _count) => _sum + _count, 0) / 6;
	const _bias    = Math.max(0, Math.min(1, _strength));
	const _weights = _counts.map(_count => 1 + (_bias * (_average - _count)) / (_average + _count + 1));
	let _choice    = _random.next() * _weights.reduce((_sum, _weight) => _sum + _weight, 0);
	for(let i = 0; i < 5; i++) {
		_choice -= _weights[i];
		if(_choice < 0) return 1 << i;
	}
	return 1 << 5;
}

export function score_rate(_mask, _config) {
	return _config.score_rates[color_count(_mask)];
}

export function orb_angle(_index, _now, _actor_id, _mask = ALL_COLORS) {
	const _rank = color_count(_mask & ((1 << _index) - 1));
	return _now * 2.4 + _actor_id * 0.7 + (_rank * Math.PI * 2) / Math.max(1, color_count(_mask));
}
// art-directed body colors indexed by the six-bit inventory, never RGB averages.
const BODY_COLORS = (
	'9a96a0 ff1800 ff8000 ff4800 ffe600 ffaa00 ffc400 ffb000 ' +
	'00ef32 aaff00 80ff00 00ff30 c8ff00 e8ff00 a0ff00 00ff70 ' +
	'0080ff ff0080 0060ff b000ff 00e0ff ff0050 00ffdc ff0070 ' +
	'00ffb0 00ff80 00ffc0 e000ff 00ff60 00b0ff 0090ff 00ff40 ' +
	'9000ff ff00c0 c000ff ff0090 6000ff ff00a0 a000ff ff0040 ' +
	'00ffcc d000ff 00ffa0 ff00e0 70ff00 b0ff00 00ffd0 ff6000 ' +
	'5000ff a000ff 7000ff ff00b0 0040ff ff0060 0050ff ff2000 ' +
	'00a0ff ff00d0 00f0ff ff9000 0070ff b000ff 90ff00 ffffff'
)
	.split(' ')
	.map(_hex => '#' + _hex);

export function mixed_color(_mask) {
	return BODY_COLORS[_mask];
}
