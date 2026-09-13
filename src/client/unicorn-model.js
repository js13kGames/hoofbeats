// blender Z is up; negative X points toward the horn.
export const UNICORN_VERTICES = [
	[-1.116667, -0.478292, 0.753056],
	[0.702831, -0.373124, 0.753056],
	[-1.116667, 0.478292, 0.753056],
	[0.702831, 0.373124, 0.753056],
	[-0.874119, 0, 1.661213],
	[0.897197, 0, 1.806476],
	[-1.219897, 0, 3.083794],
	[0.066221, 0.175418, 1.569511],
	[0.066221, -0.175418, 1.569511],
	[0.081556, 0, 1.779395],
	[0.995046, 0, 2.02598]
].map(([_x, _y, _z]) => [_y * 22, -(_x + 0.206918) * 22, (_z - 0.753056) * 22]);

// lower the horn for attacks without moving the feet.
export const UNICORN_HORN_TIP = 6;
export const UNICORN_DASH_HORN_POSITION = [0, 40, 20];
export const UNICORN_FACES = [
	[9, 5, 3, 7],
	[8, 1, 5, 9],
	[4, 2, 6],
	[0, 4, 6],
	[0, 8, 9, 4],
	[4, 9, 7, 2],
	[8, 7, 9],
	[5, 1, 10],
	[3, 5, 10]
];
