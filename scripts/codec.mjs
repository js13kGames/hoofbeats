// context model and rANS adapted from Roadroller; see vendor/ROADROLLER-LICENSE.


export function codec(_length, _selectors, _bits, _max_count, _divisor, _learning, _read_bit) {
	const _size        = 1 << _bits;
	const _mask        = _size - 1;
	const _count       = _selectors.length;
	const _predictions = new Uint16Array(_count * _size).fill(32768);
	const _counts      = new Uint8Array(_count * _size);
	const _weights     = new Float64Array(_count);
	const _stretch  = new Float64Array(_count);
	const _indices  = new Int32Array(_count);
	const _contexts = new Int32Array(_count);
	const _logs     = new Float64Array(65536);
	const _output   = new Uint8Array(_length);
	for(let i = 0; i < 65536; i++) _logs[i] = Math.log((2 * i + 1) / (131072 - 2 * i - 1));
	for(let _position = 0; _position < _length; _position++) {
		for(let k = 0; k < _count; k++) {
			let _hash = 0;
			for(let j = 8; j >= 0; j--) {
				if((_selectors[k] >> j) & 1) _hash = ((_hash + (_output[_position - j - 1] || 0)) * 997) | 0;
			}
			_contexts[k] = _hash;
		}
		let _tree = 1;
		for(let _bit = 7; _bit >= 0; _bit--) {
			let _total = 0;
			for(let k = 0; k < _count; k++) {
				const _index = k * _size + ((_contexts[k] + _tree) & _mask);
				_indices[k] = _index;
				_stretch[k] = _logs[_predictions[_index]];
				_total += _weights[k] * _stretch[k];
			}
			const _probability = (131071 / (1 + Math.exp(-_total))) | 1;
			const _actual      = _read_bit(_probability, _position, _bit);
			for(let k = 0; k < _count; k++) {
				const _index = _indices[k];
				if(_counts[_index] < _max_count) _counts[_index]++;
				_predictions[_index] +=
					(((((_actual << 16) - _predictions[_index]) << 13) / (_counts[_index] + 1 / _divisor)) |
						0) >>
					13;
				_weights[k] += (_stretch[k] / _learning) * (_actual - _probability / 131072);
			}
			_tree = _tree * 2 + _actual;
		}
		_output[_position] = _tree - 256;
	}
	return _output;
}
