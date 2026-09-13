import { UNICORN_VERTICES, UNICORN_FACES } from './unicorn-model.js';
import { PALETTE } from '../core/colors.js';

export function lesson_visual(_index) {
	const pony = (_x, _flat, _color) =>
		`<g transform="translate(${_x} 106) scale(1 ${_flat ? 0.15 : 1})" fill="${_color}">${UNICORN_FACES.map(
			(_face, i) =>
				`<polygon points="${_face
					.map(j => {
						const [_x, _y, _z] = UNICORN_VERTICES[j];
						return `${_y + _x * 0.4},${-_z + _x * 0.3}`;
					})
					.join(' ')}" fill-opacity="${0.5 + i / 18}"/>`
		).join('')}</g>`;
	const orb    = (_x, _y, _color) => `<circle cx="${_x}" cy="${_y}" r="5" fill="${_color}"/>`;
	let _drawing = pony(_index === 2 ? 120 : 48, false, _index === 2 ? '#fff' : PALETTE[0]);
	if(_index === 2) {
		PALETTE.forEach((_color, i) => {
			const _a = (i * Math.PI) / 3;
			_drawing += orb(120 + Math.cos(_a) * 48, 80 + Math.sin(_a) * 48, _color);
		});
	} else {
		_drawing += pony(190, _index === 0, PALETTE[4]);
		_drawing += '<path d="M85 85H150l-10-8m10 8-10 8" fill="none" stroke="white" stroke-width="3"/>';
		if(_index === 0) for(let i = 0; i < 3; i++) _drawing += orb(160 + i * 14, 120, PALETTE[i + 2]);
		else
			_drawing +=
				orb(117, 85, PALETTE[0]) + '<text x="185" y="42" fill="#ffe600" font-size="24">✦</text>';
	}
	return `<svg viewBox="0 0 240 160" aria-hidden="true">${_drawing}</svg>`;
}
