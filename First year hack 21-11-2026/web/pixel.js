// 8-bit pixel art for Song Craft / Film Craft.
//
// Every sprite is drawn from a grid of characters: each character is one pixel, '.' is see-through,
// and the palette says which colour each other character is. To add or edit art, change the grids
// below. Every row of a sprite must be the same length.
'use strict';

const PIXEL_ART = {
  // ---------------------------------------------------------------- music
  note: {
    palette: { N: '#ff4fa3', W: '#ffd1e8' },
    rows: [
      '................',
      '.....NNNNNNNNNN.',
      '.....NNNNNNNNNN.',
      '.....N........N.',
      '.....N........N.',
      '.....N........N.',
      '.....N........N.',
      '.....N........N.',
      '.....N........N.',
      '..NNNN.....NNNN.',
      '.NNNNN....NNNNN.',
      '.NWNNN....NWNNN.',
      '.NNNNN....NNNNN.',
      '..NNN......NNN..',
    ],
  },
  guitar: {
    palette: { k: '#1a1a1a', H: '#3b2a1a', N: '#8b5a2b', O: '#ff8a2b', Y: '#ffd34f' },
    rows: [
      '.......kk.......',
      '......kHHk......',
      '......kHHk......',
      '.......kk.......',
      '.......NN.......',
      '.......NN.......',
      '.......NN.......',
      '....OOONNOOO....',
      '...OYOONNOOOO...',
      '....OOONNOOO....',
      '...OOOOkkOOOO...',
      '..OYOOkkkkOOOO..',
      '..OOOOOkkOOOOO..',
      '..OOOOOHHOOOOO..',
      '...OOOOOOOOOO...',
      '.....OOOOOO.....',
    ],
  },
  vinyl: {
    palette: { K: '#1d1d24', G: '#5b5b6b', R: '#ff4fa3', W: '#f5f0ff' },
    rows: [
      '.....KKKKKK.....',
      '...KKKKKKKKKK...',
      '..KKGGKKKKKKKK..',
      '.KKGKKKKKKKKKKK.',
      '.KGKKKKRRKKKKKK.',
      'KKKKKKRRRRKKKKKK',
      'KKKKKRRRRRRKKKKK',
      'KKKKKRRWWRRKKKKK',
      'KKKKKRRWWRRKKKKK',
      'KKKKKRRRRRRKKKKK',
      'KKKKKKRRRRKKKKKK',
      '.KKKKKKRRKKKKGK.',
      '.KKKKKKKKKKKGKK.',
      '..KKKKKKKKGGKK..',
      '...KKKKKKKKKK...',
      '.....KKKKKK.....',
    ],
  },
  mic: {
    palette: { G: '#cfd3dc', g: '#7a7f8c', k: '#222222', K: '#3a3a46' },
    rows: [
      '.....GGGGGG.....',
      '....GgGgGgGG....',
      '....GGgGgGgG....',
      '....GgGgGgGG....',
      '....GGgGgGgG....',
      '.....GGGGGG.....',
      '......kkkk......',
      '......kKKk......',
      '.......KK.......',
      '.......KK.......',
      '.......KK.......',
      '.......KK.......',
      '.......KK.......',
      '.......KK.......',
      '.....KKKKKK.....',
      '....KKKKKKKK....',
    ],
  },
  boombox: {
    palette: { K: '#222222', R: '#e8344e', W: '#ffffff', Y: '#ffd34f', G: '#9a9aa8' },
    rows: [
      '....KKKKKKKK....',
      '....K......K....',
      'RRRRRRRRRRRRRRRR',
      'RRWRWRRRRRRWRWRR',
      'RRRRRRRRRRRRRRRR',
      'RRKKKKRYYRKKKKRR',
      'RKKGGKKYYKKGGKKR',
      'RKGKKGKRRKGKKGKR',
      'RKGKKGKRRKGKKGKR',
      'RKKGGKKRRKKGGKKR',
      'RRKKKKRRRRKKKKRR',
      'RRRRRRRRRRRRRRRR',
    ],
  },
  headphones: {
    palette: { K: '#222222', A: '#8a5cff' },
    rows: [
      '.....KKKKKK.....',
      '...KKAAAAAAKK...',
      '..KAK......KAK..',
      '.KAK........KAK.',
      '.KK..........KK.',
      '.KK..........KK.',
      '.KK..........KK.',
      'KAAK........KAAK',
      'KAAAK......KAAAK',
      'KAAAK......KAAAK',
      'KAAAK......KAAAK',
      'KAAK........KAAK',
      '.KK..........KK.',
    ],
  },
  heart: {
    palette: { R: '#ff3b5c', W: '#ffd1dc' },
    rows: [
      '.RR...RR.',
      'RWRR.RRRR',
      'RWRRRRRRR',
      'RRRRRRRRR',
      '.RRRRRRR.',
      '..RRRRR..',
      '...RRR...',
      '....R....',
    ],
  },

  // ---------------------------------------------------------------- film
  clapper: {
    palette: { K: '#1a1a1a', W: '#f2f2f2', G: '#3a3a3a' },
    rows: [
      'KWWKKWWKKWWKKWWK',
      'WWKKWWKKWWKKWWKK',
      'KKKKKKKKKKKKKKKK',
      'KWWKKWWKKWWKKWWK',
      'KKKKKKKKKKKKKKKK',
      'KGGGGGGGGGGGGGGK',
      'KGWWWWGGGWWWWWGK',
      'KGGGGGGGGGGGGGGK',
      'KGWWWGGGGWWWWGGK',
      'KGGGGGGGGGGGGGGK',
      'KGWWWWWWGGWWWGGK',
      'KGGGGGGGGGGGGGGK',
      'KKKKKKKKKKKKKKKK',
    ],
  },
  camera: {
    palette: { K: '#1a1a1a', G: '#9aa0ab', A: '#444b57', R: '#ff3b3b' },
    rows: [
      '..KKKK..KKKK....',
      '.KGGGGKKGGGGK...',
      '.KGKKGKKGKKGK...',
      '.KGGGGKKGGGGK...',
      '..KKKK..KKKK....',
      'KKKKKKKKKKKKK...',
      'KAAAAAAAAAAAK.KK',
      'KAAAAAAAAAAAKKGK',
      'KAARRAAAAAAAKGGK',
      'KAAAAAAAAAAAKKGK',
      'KAAAAAAAAAAAK.KK',
      'KKKKKKKKKKKKK...',
      '....K....K......',
      '...K......K.....',
    ],
  },
  popcorn: {
    palette: { W: '#fff3c4', Y: '#ffcf3a', R: '#e0262e', S: '#ffffff' },
    rows: [
      '...WW..WW.....',
      '..WWWWWWWWW...',
      '.WWYWWWWYWWW..',
      '.WWWWWYWWWWWW.',
      '..WWWWWWWWWW..',
      '.RRSSRRSSRRSS.',
      '.RRSSRRSSRRSS.',
      '..RSSRRSSRRS..',
      '..RSSRRSSRRS..',
      '..RSSRRSSRRS..',
      '...SSRRSSRR...',
      '...SSRRSSRR...',
      '...SSRRSSRR...',
    ],
  },
  ufo: {
    palette: { C: '#8ff3ff', W: '#ffffff', G: '#9aa0ab', Y: '#ffe14d' },
    rows: [
      '......CCCC......',
      '.....CWCCCC.....',
      '....CCCCCCCC....',
      '..GGGGGGGGGGGG..',
      '.GGYGGYGGYGGYGG.',
      'GGGGGGGGGGGGGGGG',
      '..GGGGGGGGGGGG..',
      '....Y..Y..Y.....',
    ],
  },
  shark: {
    palette: { G: '#6f7d8c', B: '#2f7bd9', W: '#bfe3ff' },
    rows: [
      '........G.......',
      '.......GG.......',
      '......GGG.......',
      '.....GGGG.......',
      '....GGGGG.......',
      '...GGGGGGG......',
      '..GGGGGGGGG.....',
      'BBBBBBBBBBBBBBBB',
      'BWBBBWBBBWBBBWBB',
      'BBBBBBBBBBBBBBBB',
    ],
  },
  dino: {
    palette: { G: '#3fbf5a', W: '#ffffff' },
    rows: [
      '.........GGGGGG.',
      '........GGWGGGGG',
      '........GGGGGGGG',
      '........GGGGG...',
      '........GGGGGGG.',
      'G......GGGGG....',
      'G.....GGGGGG....',
      'GG...GGGGGGGGG..',
      'GGGGGGGGGGGG.G..',
      '.GGGGGGGGGGG....',
      '..GGGGGGGGGG....',
      '...GGGGGGGG.....',
      '....GGG.GG......',
      '....GG...G......',
      '....G....G......',
      '....GG...GG.....',
    ],
  },
  saber: {
    palette: { L: '#4dff6a', W: '#eaffea', K: '#333333', G: '#aaaaaa', R: '#e33333' },
    rows: [
      '..............LL',
      '.............LWL',
      '............LWL.',
      '...........LWL..',
      '..........LWL...',
      '.........LWL....',
      '........LWL.....',
      '.......LWL......',
      '......LWL.......',
      '.....KGK........',
      '....KGK.........',
      '...KGK..........',
      '..KRK...........',
      '.KKK............',
    ],
  },
  trophy: {
    palette: { Y: '#ffcf3a', W: '#fff7c2', K: '#3a2a10' },
    rows: [
      '..YYYYYYYY..',
      'YYYYYYYYYYYY',
      'Y.YYYWYYYY.Y',
      'Y.YYYWYYYY.Y',
      '.YYYYYYYYYY.',
      '..YYYYYYYY..',
      '...YYYYYY...',
      '.....YY.....',
      '.....YY.....',
      '....YYYY....',
      '...KKKKKK...',
      '...KKKKKK...',
    ],
  },
};

// Which art and words each game mode uses. A new mode without an entry uses `default`.
const PIXEL_THEMES = {
  music: {
    hero: 'boombox',
    title: ['note', 'guitar', 'boombox', 'mic', 'vinyl'],
    floaters: ['note', 'vinyl', 'heart', 'headphones', 'note', 'mic', 'guitar'],
    board: ['note', 'headphones', 'vinyl', 'guitar'],
    picker: ['vinyl', 'boombox', 'note'],
    tagline: 'Mix sounds. Craft hits.',
    winBanner: '★ NEW HIT! ★',
  },
  film: {
    hero: 'camera',
    title: ['popcorn', 'clapper', 'camera', 'ufo', 'dino'],
    floaters: ['popcorn', 'clapper', 'ufo', 'shark', 'saber', 'trophy', 'dino'],
    board: ['clapper', 'popcorn', 'shark', 'saber'],
    picker: ['popcorn', 'camera', 'clapper'],
    tagline: 'Mix scenes. Craft classics.',
    winBanner: "★ THAT'S A WRAP! ★",
  },
  default: {
    hero: 'trophy',
    title: ['heart', 'trophy', 'note'],
    floaters: ['heart', 'trophy', 'note'],
    board: ['heart', 'trophy', 'note', 'heart'],
    picker: ['heart', 'trophy', 'heart'],
    tagline: 'Combine things. Craft the goal.',
    winBanner: '★ YOU DID IT! ★',
  },
};

/** Draws a sprite into a small <canvas>, scaled up with crisp pixels. */
function pixelSprite(name, scale = 4, className = '') {
  const art = PIXEL_ART[name];
  if (!art) return document.createElement('span');
  const h = art.rows.length;
  const w = art.rows[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  art.rows.forEach((row, y) => {
    if (row.length !== w) console.warn(`Pixel art "${name}" row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < row.length; x++) {
      const colour = art.palette[row[x]];
      if (colour) {
        g.fillStyle = colour;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  canvas.className = ('pixel ' + className).trim();
  canvas.style.width = w * scale + 'px';
  canvas.style.height = h * scale + 'px';
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}
