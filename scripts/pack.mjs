import { minify } from 'terser';
import { codec } from './codec.mjs';

export function normalize_html(_html) {
	return _html
		.replace(
			/<script>([\s\S]*?)<\/script>/g,
			(_match, _script) =>
				'<script>' +
				_script.replace(
					/[^\x00-\x7f]/g,
					_character => '\\u' + _character.charCodeAt(0).toString(16).padStart(4, '0')
				) +
				'</script>'
		)
		.replace(/[^\x00-\x7f]/g, _character => '&#' + _character.charCodeAt(0) + ';');
}

export function pack_html(_input, _options) {
	const {
		selectors: _selectors,
		bits: _bits,
		max_count: _max_count,
		divisor: _divisor,
		learning: _learning,
		abbreviations: _abbreviations
	} = _options;
	if(/[^\x00-\x7f]/.test(_input)) throw new Error('ASCII input required');
	if(
		!Array.isArray(_selectors) ||
		!_selectors.length ||
		_selectors.some(_value => !Number.isInteger(_value) || _value < 0 || _value > 511)
	) {
		throw new Error('Invalid selectors');
	}
	if(!Number.isInteger(_bits) || _bits < 10 || _bits > 20) throw new Error('Invalid model size');
	if(!Number.isInteger(_max_count) || _max_count < 1 || _max_count > 255)
		throw new Error('Invalid model count');
	if(![_divisor, _learning].every(_value => Number.isFinite(_value) && _value > 0))
		throw new Error('Invalid model rates');
	if(!Number.isInteger(_abbreviations) || _abbreviations < 1 || _abbreviations > 128)
		throw new Error('Invalid token count');
	const _frequency = new Map();
	for(const _word of _input.match(/[A-Za-z_$][\w$]*/g) || []) {
		if(_word.length > 1) _frequency.set(_word, (_frequency.get(_word) || 0) + 1);
	}
	const _selected = [..._frequency]
		.sort((_a, _b) => (_b[0].length - 1) * (_b[1] - 1) - (_a[0].length - 1) * (_a[1] - 1))
		.slice(0, _abbreviations)
		.map(([_word]) => _word);
	const _dictionary = Array(128).fill('').concat(_selected);
	const _lookup     = new Map(_selected.map((_word, i) => [_word, String.fromCharCode(128 + i)]));
	const _text       = _input.replace(/[A-Za-z_$][\w$]*/g, _word => _lookup.get(_word) || _word);
	const _bytes      = Uint8Array.from(_dictionary.join('|') + '|' + _text, _character =>
		_character.charCodeAt(0)
	);
	// the decoder spreads these bytes into a function call.
	if(_bytes.length > 60000) throw new Error('Document exceeds decoder argument budget');
	const _probabilities = new Uint32Array(_bytes.length * 8);
	const _actuals       = new Uint8Array(_probabilities.length);
	let _tick            = 0;
	codec(
		_bytes.length,
		_selectors,
		_bits,
		_max_count,
		_divisor,
		_learning,
		(_probability, _position, _bit) => {
			_probabilities[_tick] = _probability;
			const _value = (_bytes[_position] >> _bit) & 1;
			_actuals[_tick++] = _value;
			return _value;
		}
	);
	let _state    = 1048576;
	const _output = [];
	for(let i = _tick - 1; i >= 0; i--) {
		const _probability = _probabilities[i];
		const _bit         = _actuals[i];
		const _size        = _bit ? _probability : 131072 - _probability;
		const _start       = _bit ? 0 : _probability;
		while(_state >= _size * 2048) {
			_output.push(_state & 255);
			_state = Math.floor(_state / 256);
		}
		_state = Math.floor(_state / _size) * 131072 + (_state % _size) + _start;
	}
	_output.reverse();
	return {
		state: _state,
		data: Buffer.from(_output).toString('base64'),
		length: _bytes.length,
		dictionary_slots: _dictionary.length,
		options: _options
	};
}

// keep arithmetic order in sync with codec; both sides update a floating-point model.

function decode_document(
	_state,
	_data,
	_length,
	_selectors,
	_bits,
	_max_count,
	_divisor,
	_learning,
	_dictionary_slots
) {
	_data = atob(_data);
	const _size        = 1 << _bits;
	const _count       = _selectors.length;
	const _predictions = new Uint16Array(_count * _size).fill(32768);
	const _counts      = new Uint8Array(_count * _size);
	const _weights     = new Float64Array(_count);
	const _contexts    = new Int32Array(_count);
	const _logs   = new Float64Array(65536);
	const _output = new Uint8Array(_length);
	let _offset   = 0;
	for(let i = 0; i < 65536; i++) _logs[i] = Math.log((2 * i + 1) / (131072 - 2 * i - 1));
	for(let _position = 0; _position < _output.length; _position++) {
		for(let k = 0; k < _count; k++) {
			let _hash = 0;
			for(let j = 8; j >= 0; j--) {
				if((_selectors[k] >> j) & 1) _hash = ((_hash + (_output[_position - j - 1] || 0)) * 997) | 0;
			}
			_contexts[k] = _hash;
		}
		let _tree = 1;
		for(let j = 7; j >= 0; j--) {
			let _total = 0;
			for(let k = 0; k < _count; k++) {
				_total +=
					_weights[k] * _logs[_predictions[k * _size + ((_contexts[k] + _tree) & (_size - 1))]];
			}
			const _probability = (131071 / (1 + Math.exp(-_total))) | 1;
			const _remainder   = _state & 131071;
			const _actual      = +(_remainder < _probability);
			_state =
				(_actual ? _probability : 131072 - _probability) * (_state >> 17) +
				_remainder -
				(_actual ? 0 : _probability);
			while(_state < 1048576) _state = _state * 256 + _data.charCodeAt(_offset++);
			for(let k = 0; k < _count; k++) {
				const _index = k * _size + ((_contexts[k] + _tree) & (_size - 1));
				_weights[k] += (_logs[_predictions[_index]] / _learning) * (_actual - _probability / 131072);
				if(_counts[_index] < _max_count) _counts[_index]++;
				_predictions[_index] +=
					(((((_actual << 16) - _predictions[_index]) << 13) / (_counts[_index] + 1 / _divisor)) |
						0) >>
					13;
			}
			_tree = _tree * 2 + _actual;
		}
		_output[_position] = _tree - 256;
	}
	const _text       = String.fromCharCode(..._output).split('|');
	const _dictionary = _text.splice(0, _dictionary_slots);
	document.write(
		_text.join('|').replace(/[\s\S]/g, _character => _dictionary[_character.charCodeAt(0)] || _character)
	);
}

export async function emit_html(_packed) {
	const _options   = _packed.options;
	const _arguments = [
		_packed.state,
		'__PACKED_DATA__',
		_packed.length,
		_options.selectors,
		_options.bits,
		_options.max_count,
		_options.divisor,
		_options.learning,
		_packed.dictionary_slots
	];
	const _source = `(()=>{const _data="__PACKED_DATA__";(${decode_document.toString()})(${_arguments.map((_value, i) => (i === 1 ? '_data' : JSON.stringify(_value))).join(',')});})();`;
	const _result = await minify(_source, {
		compress: { passes: 3, reduce_vars: false, collapse_vars: false },
		mangle: true,
		ecma: 2020
	});
	return (
		'<!doctype html><meta charset=utf-8><script>' +
		_result.code.replace('"__PACKED_DATA__"', JSON.stringify(_packed.data)) +
		'</script>'
	);
}
