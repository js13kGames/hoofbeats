export const DEFAULT_CONFIG = Object.freeze({

	// arena
	ground_grid_spacing: 125,
	ground_grid_color: '#080f20',
	ground_grid_width: 1,
	action_speed_per_color: 0.03,
	bot_action_speed_multiplier: 0.9,
	bot_score_rate_multiplier: 0.9,
	actor_count: 16,
	max_humans: 8,
	tick_rate: 60,
	arena_x: 1000,
	arena_y: 1000,

	// movement
	move_speed: 400,
	acceleration: 3,
	turn_speed: 5,
	pivot_speed: 50,
	coast_drag: 5,
	bank_response: 10,

	// shots
	shot_speed: 1250,
	shot_seconds: 0.4,
	shot_cooldown: 1,
	shot_radius: 24,
	recovery_seconds: 1.5,
	flatten_seconds: 1,
	stomp_score: 25,
	pickup_score: 10,
	homing_range: 300,

	// round
	round_seconds: 60,
	ready_seconds: 1.5,
	go_seconds: 0.65,
	results_seconds: 7,
	results_time_scale: 0.1,

	// dash
	dash_speed: 1200,
	dash_seconds: 0.35,
	dash_recovery_seconds: 0.25,
	dash_cooldown: 1.5,
	hit_radius: 25,
	stun_seconds: 1,
	invulnerable_seconds: 2,

	// pickups
	player_reach_multiplier: 1.2,
	spawn_grace_seconds: 0,
	pickup_radius: 50,
	spill_lock_seconds: 0.5,
	pickup_pull_seconds: 0.15,
	spill_speed_min: 220,
	spill_speed_max: 900,
	ambient_colors: 15,
	color_spawn_seconds: 8,
	pickup_lifetime: 20,
	color_balance_strength: 0.35,
	score_rates: Object.freeze([5, 10, 15, 20, 25, 35, 50]),
	seed: 0x61726961,

	// trails
	trail_max_length: 1000,
	trail_max_seconds: 3,
	trail_max_width: 14,
	dash_trail_max_length: 320,
	dash_trail_max_seconds: 0.38,
	dash_trail_max_width: 28,
	trail_min_scale: 0.2,
	trail_scale_exponent: 3,
	trail_lane_spacing: 4,
	trail_rear_offset: 12,
	trail_height: 12,
	dash_trail_height: 9,
	trail_opacity: 1,
	trail_fade_exponent: 1,
	trail_sample_seconds: 1 / 60,
	trail_max_points: 180,

	// bots
	bot_think_min_seconds: 0.15,
	bot_think_max_seconds: 0.3,
	bot_human_pressure_by_colors: Object.freeze([0.5, 0.7, 0.8, 0.9, 0.9, 1, 1]),

	// defense
	bot_threat_range: 180,
	bot_threat_path_radius: 60,
	bot_flee_min_colors: 3,
	bot_flee_base_range: 200,
	bot_flee_range_per_color: 75,
	bot_escape_dash_range: 200,
	bot_escape_aim_tolerance: 0.35,
	bot_preserve_min_colors: 5,

	// targets
	bot_hunt_min_target_colors: 2,
	bot_hunt_weight: 32,
	bot_hunt_target_color_exponent: 4,
	bot_cautious_min_colors: 3,
	bot_hunt_held_color_exponent: 2,
	bot_pickup_weight: 0.35,
	bot_crowd_penalty: 1.5,
	bot_pursuit_lead_seconds: 0.35,

	// attacks
	bot_shoot_below_colors: 4,
	bot_attack_dash_below_colors: 4,
	bot_attack_aim_tolerance: 0.25,
	bot_shot_min_range: 65,
	bot_shot_hesitation_seconds: 0.2,
	bot_shot_max_range: 260,
	bot_attack_dash_range: 180,
	bot_combo_min_target_colors: 2 // minimum victim inventory for following a stun with a dash.
});
