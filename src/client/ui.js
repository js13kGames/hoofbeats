import { PALETTE, score_rate } from '../core/colors.js';
import { lesson_visual } from './presentation.js';
import { COPY } from '../copy.js';
const node = _id => document.getElementById(_id);

function text(_id, _value) {
	if(node(_id).textContent !== _value) node(_id).textContent = _value;
}
export const HIGH_SCORE_KEY = 'hoofbeats:high-score:v1';

export class UI {
	screen = 'home';
	clock = 0;
	result_round = null;
	constructor() {
		try {
			this.best = Math.max(0, Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0);
		} catch {
			this.best = 0;
		}
		if(!Number.isFinite(this.best)) this.best = 0;
		text('best-score', this.best.toLocaleString());
		this.slots = PALETTE.map((_color, i) => {
			const _slot = document.createElement('i');
			const _a    = (i * Math.PI) / 3 - Math.PI / 2;
			_slot.style.transform = `translate(calc(var(--dial-orbit) * ${Math.cos(_a)}),calc(var(--dial-orbit) * ${Math.sin(_a)}))`;
			node('color-dial').append(_slot);
			return _slot;
		});
		this.lessons = [...document.querySelectorAll('.lesson')];
		this.lessons.forEach((_lesson, i) => {
			_lesson.querySelector('button').addEventListener('click', () => this.open_lesson(i));
			_lesson.querySelector('p').innerHTML = COPY.lessons[i].replace(
				/DASH|SHOOT/g,
				_action => `<strong style="color:var(--${_action.toLowerCase()}-color)">${_action}</strong>`
			);
			_lesson.querySelector('.lesson-visual').innerHTML = lesson_visual(i);
		});
		node('how-to-play').onclick = () => {
			this.show('help');
			this.open_lesson(0);
		};
		node('help-back').onclick = () => this.show('home');
		node('results-home').onclick = () => this.show('home');
		addEventListener('keydown', _event => {
			if(_event.key === 'Escape' && this.screen === 'help') this.show('home');
		});
		this.open_lesson(0);
		this.show('home');
	}

	show(_screen) {
		this.screen = _screen;
		for(const _id of ['home', 'help', 'results']) node(_id).hidden = _id !== _screen;
		for(const _id of ['hud', 'touch-actions', 'joystick']) node(_id).hidden = _screen !== 'game';
		if(_screen !== 'game') {
			node('round-callout').hidden = true;
			node('paused').hidden = true;
		}
		if(_screen === 'help') node('lesson-dashing').focus();
		if(_screen === 'home') node('start-game').focus();
	}

	start(_callback) {
		_callback();
		this.end_time = null;
		this.show('game');
		node('start-game').blur();
		node('play-again').blur();
	}

	open_lesson(_index) {
		this.lessons.forEach((_lesson, i) => {
			_lesson.classList.toggle('open', i === _index);
			_lesson.querySelector('button').setAttribute('aria-expanded', String(i === _index));
			_lesson.querySelector('.lesson-detail').hidden = i !== _index;
		});
	}

	results(_world, _player_id) {
		if(this.result_round === _world.round) return;
		this.result_round = _world.round;
		const _score      = Math.floor(_world.actors[_player_id].score);
		const _record     = _score > this.best;
		if(_record) {
			this.best = _score;
			try {
				localStorage.setItem(HIGH_SCORE_KEY, String(_score));
			} catch {}
			text('best-score', _score.toLocaleString());
		}
		const _list = node('rankings');
		_list.replaceChildren();
		let _player_row;
		[..._world.actors]
			.sort((_a, _b) => _b.score - _a.score || _a.id - _b.id)
			.forEach((_actor, i) => {
				const _row    = document.createElement('li');
				const _name   = document.createElement('span');
				const _points = document.createElement('span');
				_name.textContent = COPY.ranking(i + 1, _actor.name);
				_points.textContent = Math.floor(_actor.score).toLocaleString();
				_row.append(_name, _points);
				if(_actor.id === _player_id) {
					_row.className = 'player';
					_player_row = _row;
					if(_record) _name.textContent += ` — ${COPY.new_record}`;
				}
				_list.append(_row);
			});
		node('results-home').hidden = node('play-again').hidden = false;
		this.show('results');
		_player_row.scrollIntoView({ block: 'center' });
		node('play-again').focus({ preventScroll: true });
	}

	update(_world, _player_id, _paused, _elapsed = 0) {
		this.clock += _elapsed;
		if(this.screen !== 'game') return;
		const _player  = _world.actors[_player_id];
		const _results = _world.round_phase === 'results';
		const _ready   = _world.round_phase === 'ready';
		const _seconds = _results ? 0 : Math.max(0, _world.round_ends_at - _world.now);
		const _rate    = _ready || _results ? 0 : score_rate(_player.color_mask, _world.config);
		text('stats', COPY.score(Math.floor(_player.score)));
		text('score-rate', COPY.score_rate(_rate));
		this.slots.forEach((_slot, i) => {
			_slot.style.background = _player.color_mask & (1 << i) ? PALETTE[i] : '#49404f';
		});
		text('time-left', _seconds.toFixed(1));
		node('timer-ring').style.setProperty(
			'--remaining',
			`${Math.max(0, Math.min(1, _seconds / _world.config.round_seconds))}turn`
		);
		node('paused').hidden = !_paused;
		const _go = _world.round_phase === 'playing' && _world.real_time < _world.go_until;
		node('round-callout').hidden = !_ready && !_go && !_results;
		node('round-callout').dataset.phase = _world.round_phase;
		let _callout = COPY.round.go;
		if(_ready) _callout = COPY.round.ready;
		else if(_results) _callout = COPY.round.results;
		text('round-callout-title', _callout);
		const _countdown = _ready
			? 3 *
				Math.max(
					0,
					Math.min(1, (_world.ready_until - _world.real_time) / _world.config.ready_seconds)
				)
			: 0;
		node('round-countdown-row').hidden = !_ready;
		node('round-countdown-bar').value = _countdown;
		text('round-countdown', _ready ? _countdown.toFixed(1) : '');
		const _lock        = _world.combo_victim(_player);
		const _cooldown    = _lock ? 0 : Math.max(0, _player.dash_ready_at - _world.now);
		const _unavailable =
			_paused ||
			_ready ||
			_results ||
			_player.stunned_until > _world.now ||
			_player.state === 'flattened';
		node('dash-button').disabled = _unavailable || _cooldown > 0;
		text('dash-button', _cooldown ? _cooldown.toFixed(1) : COPY.text['dash-button']);
		node('dash-button').classList.toggle('locked', Boolean(_lock));
		node('shoot-button').disabled =
			_unavailable || !_player.color_mask || _player.shot_ready_at > _world.now;
		if(_results) {
			this.end_time ??= this.clock;
			if(this.clock - this.end_time > 1.5) this.results(_world, _player_id);
		}
	}
}
