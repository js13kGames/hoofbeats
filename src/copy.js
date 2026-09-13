export const COPY = {
	text: {
		'page-title': 'HOOFBEATS',
		'game-title': 'HOOFBEATS',
		'start-label': 'START GAME',
		'help-label': 'HOW TO PLAY',
		'high-score-label': 'HI-SCORE',
		'creator-label': 'a game by aria',
		'creator-link': 'unicornfan.com',
		'dash-button': 'DASH',
		'shoot-button': 'SHOOT',
		'pause-button': 'Ⅱ',
		resume: 'RESUME',
		'pause-title': 'TITLE',
		'help-title': 'HOW TO PLAY',
		'lesson-dashing': 'DASH',
		'lesson-shooting': 'SHOOT',
		'lesson-scoring': 'SCORING',
		'help-back': 'RETURN',
		'results-title': 'RANKING',
		'play-again': 'RETRY',
		'results-home': 'TITLE'
	},
	lessons: [
		'DASH through enemy unicorns!\nSteal their colors!',
		'SHOOT a color like a bullet to stun retreating enemies!\nYour DASH will target stunned unicorns for a combo attack!',
		'Score points over time for each color held!\nComplete the rainbow for massive points!\nBe careful; everyone else wants to score, too!'
	],
	round: { ready: 'READY', results: 'GAME SET', go: 'GO!' },
	new_record: 'NEW RECORD!',
	player_name: 'YOU',
	pony_name: _number => `UNICORN ${_number}`,
	ranking: (_rank, _name) => `#${_rank}: ${_name}`,
	score: _value => `SCORE: ${_value.toLocaleString()}`,
	score_rate: _value => `+${_value}`
};
