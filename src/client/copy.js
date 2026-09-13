import { COPY } from '../copy.js';

export function apply_copy() {
	for(const [_id, _value] of Object.entries(COPY.text)) document.getElementById(_id).textContent = _value;
}
