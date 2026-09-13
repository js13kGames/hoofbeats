export class Random {
	constructor(_seed = 1) {
		this.state = _seed >>> 0;
	}

	next() {
		let _t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
		_t = Math.imul(_t ^ (_t >>> 15), _t | 1);
		_t ^= _t + Math.imul(_t ^ (_t >>> 7), _t | 61);
		return ((_t ^ (_t >>> 14)) >>> 0) / 4294967296;
	}

	int(_max) {
		return Math.floor(this.next() * _max);
	}

	range(_min, _max) {
		return _min + this.next() * (_max - _min);
	}
}
