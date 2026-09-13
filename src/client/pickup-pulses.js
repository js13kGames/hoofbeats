const PULSE_SECONDS     = 0.65;
const BATCH_GAP         = 0.08;
const MAX_BATCH_SECONDS = 0.7;

export class PickupPulses {
	constructor() {
		this.round   = null;
		this.events  = [];
		this.pending = new Map();
	}

	reset_round(_round) {
		if(this.round !== _round) {
			this.round  = _round;
			this.events = [];
			this.pending.clear();
		}
	}

	add(_event, _round) {
		this.reset_round(_round);
		if(_event.type !== 'pickup') return;
		const _batch = this.pending.get(_event.actor_id);
		if(_batch) {
			_batch.color |= _event.color;
			_batch.last_at = _event.time;
			_batch.x = _event.x;
			_batch.y = _event.y;
		} else this.pending.set(_event.actor_id, { ..._event, first_at: _event.time, last_at: _event.time });
	}

	sample(_now, _round, _pickups = []) {
		this.reset_round(_round);
		const _in_flight = new Set(_pickups.filter(_p => _p.collector_id != null).map(_p => _p.collector_id));
		for(const [_actor_id, _batch] of this.pending) {
			if(
				_now - _batch.first_at < MAX_BATCH_SECONDS &&
				(_in_flight.has(_actor_id) || _now - _batch.last_at < BATCH_GAP)
			)
				continue;
			this.events.push({ ..._batch, time: _now });
			this.pending.delete(_actor_id);
		}
		this.events = this.events.filter(_event => _now - _event.time < PULSE_SECONDS).slice(-64);
		return this.events.map(_event => {
			const _t    = Math.max(0, (_now - _event.time) / PULSE_SECONDS);
			const _ease = 1 - (1 - _t) ** 2;
			return { ..._event, source: _event, scale: 1 + _ease * 1.25, alpha: 0.95 * (1 - _t) };
		});
	}
}
