import fs from 'node:fs/promises';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const OUT = 'D:/My_All_proj/Game_Network/presentation_build';
const W = 1280, H = 720;
const C = { paper: '#F3EBDD', ink: '#2B2926', brown: '#6B4931', red: '#A5322D', blue: '#234B5C', mint: '#6A9B91', gold: '#C69A4B', white: '#FFFDF8', dark: '#17232A', purple: '#5A416E' };
const deck = Presentation.create({ slideSize: { width: W, height: H } });
const readBytes = async (p) => { const b = await fs.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const charA = await readBytes('D:/My_All_proj/Game_Network/public/assets/character-left.png');
const charB = await readBytes('D:/My_All_proj/Game_Network/public/assets/character-right.png');
const uiShot = await readBytes('D:/My_All_proj/Game_Network/presentation_build/Two-Rooms-One-Network-Proposal/slide-7.png');

function shape(s, geometry, x, y, w, h, fill='none', line='none') {
  return s.shapes.add({ geometry, position: { left:x, top:y, width:w, height:h }, fill, line: { style:'solid', fill:line, width: line === 'none' ? 0 : 2 } });
}
function text(s, value, x, y, w, h, size=18, color=C.ink, bold=false, align='left', font='Arial') {
  const t = shape(s, 'textbox', x, y, w, h);
  t.text = value;
  t.text.style = { fontSize:size, color, bold, alignment:align, fontFamily:font };
  return t;
}
function image(s, blob, x, y, w, h, alt, fit='contain') {
  s.images.add({ blob, contentType:'image/png', alt, fit, position:{left:x, top:y, width:w, height:h} });
}
function line(s, x1, y1, x2, y2, color=C.brown, width=2) {
  const l = s.shapes.add({ geometry:'line', position:{left:x1, top:y1, width:x2-x1, height:y2-y1}, line:{style:'solid', fill:color, width} });
  return l;
}
function base(s, section, title, n) {
  s.background.fill = C.paper;
  shape(s, 'rect', 0, 0, W, 18, C.red);
  text(s, `TWO ROOMS, ONE NETWORK  /  ${section}`, 70, 40, 760, 22, 12, C.red, true, 'left', 'Courier New');
  text(s, title, 70, 78, 1080, 58, 31, C.ink, true);
  text(s, String(n).padStart(2,'0'), 1160, 44, 55, 24, 16, C.red, true, 'right', 'Courier New');
  line(s, 70, 150, 1210, 150, C.brown, 2);
}
function notes(s, source) { s.speakerNotes.textFrame.setText(`[Sources]\n${source}`); }
function pill(s, value, x, y, w, color=C.red) { shape(s, 'roundRect', x, y, w, 28, C.white, color); text(s, value, x+7, y+6, w-14, 16, 11, color, true, 'center', 'Courier New'); }

// 1 — Related Work #1
{ const s=deck.slides.add(); base(s,'RELATED WORK #1','Room Escape at Class turns real network operations into puzzles.',1);
  text(s,'What is it?',80,200,220,28,24,C.red,true);
  text(s,'An educational escape-room activity for Computer Networks and Information Security students.',80,240,470,68,20,C.ink,false);
  text(s,'What can it do?',80,350,260,28,24,C.blue,true);
  text(s,'• Use IP-packet construction as a game mechanic\n• Use LZ77-compressed email as a puzzle\n• Make course knowledge operational',80,392,500,96,19,C.ink,false);
  shape(s,'rect',720,205,380,290,C.dark,C.mint); text(s,'ESCAPE ROOM',770,240,280,34,25,C.white,true,'center');
  shape(s,'roundRect',795,315,230,70,C.paper,C.gold); text(s,'IP PACKET',815,338,190,24,20,C.blue,true,'center','Courier New');
  image(s,charA,760,395,80,120,'Student avatar A'); image(s,charB,990,395,80,120,'Student avatar B');
  pill(s,'LIMITATION',80,560,140,C.red); text(s,'Everyone sees the same evidence; roles and information asymmetry are not separated between players.',245,560,780,30,18,C.ink,true);
  text(s,'[1] Borrego et al. (2017)',80,650,420,18,12,C.brown,false,'left','Courier New');
  notes(s,'[1] Borrego, C. et al. (2017). Room escape at class: Escape games activities to facilitate motivation and learning in computer science.'); }

// 2 — Related Work #2
{ const s=deck.slides.add(); base(s,'RELATED WORK #2','Digital escape rooms improve engagement in technical learning.',2);
  text(s,'What is it?',80,200,220,28,24,C.red,true);
  text(s,'A 2022 study of a digital escape room focused on HTML and Computer Networks for vocational high-school students.',80,240,530,70,20,C.ink,false);
  text(s,'Reported impact',80,350,260,28,24,C.blue,true);
  const rows=[['MOTIVATION','higher'],['ENGAGEMENT','higher'],['SATISFACTION','higher']];
  rows.forEach((r,i)=>{const y=405+i*45; text(s,r[0],95,y,220,22,18,C.ink,true,'left','Courier New'); text(s,'↑',390,y,45,25,25,C.red,true,'center'); text(s,r[1],450,y,100,22,18,C.blue,true);});
  shape(s,'rect',750,220,320,260,C.purple,C.gold); text(s,'DIGITAL\nESCAPE ROOM',790,270,240,70,28,C.white,true,'center');
  text(s,'HTML  +  NETWORKS',790,390,240,24,18,C.gold,true,'center','Courier New');
  pill(s,'LIMITATION',80,560,140,C.red); text(s,'Single-player: no real-time communication, shared discovery, or coordination between two learners.',245,560,780,30,18,C.ink,true);
  text(s,'[2] Education Sciences, 12(10), 682 (2022)',80,650,560,18,12,C.brown,false,'left','Courier New');
  notes(s,'[2] The Impact of a Digital Escape Room Focused on HTML and Computer Networks on Vocational High School Students. Education Sciences, 12(10), 682 (2022).'); }

// 3 — Our work: what/functions/how
{ const s=deck.slides.add(); base(s,'OUR WORK','Two Rooms, One Network is a 2D co-op networking escape room.',3);
  text(s,'Two players are separated into different rooms and must reason together to open the gateway.',80,198,1040,32,21,C.brown,true);
  const funcs=[['WASD','explore the room'],['E','interact with a terminal'],['CMD','ping / traceroute / nslookup'],['SERVER','validate commands and gate state']];
  funcs.forEach((f,i)=>{const x=80+(i%2)*270, y=285+Math.floor(i/2)*110; shape(s,'roundRect',x,y,230,78,C.white,i===3?C.mint:C.brown); text(s,f[0],x+15,y+14,200,22,19,C.red,true,'center','Courier New'); text(s,f[1],x+12,y+44,206,20,16,C.ink,false,'center');});
  text(s,'EXPLORE',745,285,130,25,18,C.red,true,'center'); text(s,'→',885,282,45,30,25,C.red,true,'center'); text(s,'TERMINAL',935,285,150,25,18,C.blue,true,'center');
  text(s,'→',745,350,45,30,25,C.red,true,'center'); text(s,'SERVER VALIDATES',790,353,235,25,18,C.blue,true,'center'); text(s,'→',1035,350,45,30,25,C.red,true,'center'); text(s,'GATE OPENS',1080,353,130,25,18,C.red,true,'center');
  image(s,charA,760,425,75,120,'Player A'); image(s,charB,1050,425,75,120,'Player B');
  text(s,'The client renders the world; the server owns the answer, score, room state, and door state.',80,615,1040,30,19,C.ink,true,'center');
  notes(s,'Project implementation: Phaser.js, Node.js/Express, Socket.IO, PostgreSQL/Prisma.'); }

// 4 — Our work: difference
{ const s=deck.slides.add(); base(s,'OUR CONTRIBUTION','The project adds cooperation as part of the networking problem.',4);
  text(s,'Previous digital escape rooms',105,205,360,30,22,C.blue,true,'center');
  text(s,'Our game',815,205,360,30,22,C.red,true,'center');
  const left=['single-player','same information','answer can be local','engagement through puzzles'];
  const right=['two-player real-time co-op','different rooms / partial evidence','ping must be understood by both','communication is required to progress'];
  left.forEach((v,i)=>{shape(s,'rect',105,270+i*62,360,42,C.white,C.brown); text(s,v,125,281+i*62,320,20,18,C.ink,false,'center');});
  right.forEach((v,i)=>{shape(s,'rect',815,270+i*62,360,42,C.dark,C.mint); text(s,v,835,281+i*62,320,20,18,C.white,false,'center');});
  line(s,480,370,800,370,C.red,4); text(s,'EXTENSION',572,345,140,22,15,C.red,true,'center','Courier New');
  text(s,'Learning outcome: students must explain network evidence to another person, not only select an answer.',150,590,980,30,20,C.brown,true,'center');
  notes(s,'Comparison synthesized from [1] and [2], plus the project design specification.'); }

// 5 — Prototype/UI
{ const s=deck.slides.add(); base(s,'PROTOTYPE / UI','The question appears through exploration, not as a static quiz list.',5);
  shape(s,'roundRect',70,205,760,390,C.dark,C.mint); shape(s,'rect',95,230,350,315,'#183545',C.blue); shape(s,'rect',455,230,350,315,'#2A2140',C.purple); line(s,450,230,450,545,C.gold,4);
  text(s,'ROOM A',120,250,130,22,16,C.mint,true,'left','Courier New'); text(s,'ROOM B',480,250,130,22,16,'#D9A9E8',true,'left','Courier New');
  image(s,charA,270,335,78,130,'Player A'); image(s,charB,665,335,78,130,'Player B');
  shape(s,'roundRect',250,470,115,45,C.dark,C.gold); text(s,'>_  TERMINAL',257,485,100,16,12,C.gold,true,'center','Courier New');
  shape(s,'roundRect',600,470,115,45,C.dark,'#D9A9E8'); text(s,'>_  TERMINAL',607,485,100,16,12,'#D9A9E8',true,'center','Courier New');
  shape(s,'roundRect',890,240,300,210,C.white,C.red); text(s,'UI callouts',925,270,230,25,20,C.red,true); text(s,'1  WASD movement\n2  E interaction\n3  CMD terminal overlay\n4  Mission / gate status\n5  Gateway to next room',925,315,230,125,18,C.ink,false);
  text(s,'A playable 2D scene with two rooms, terminal quests, and a shared gateway.',80,630,1080,26,19,C.brown,true,'center');
  notes(s,'Project prototype visuals use the supplied character sprites: public/assets/character-left.png and character-right.png.'); }

// 6 — Proof
{ const s=deck.slides.add(); base(s,'PROOF OF IMPLEMENTATION','The application, source code, and co-op flow are testable.',6);
  image(s,uiShot,75,205,470,265,'Application architecture preview','contain');
  shape(s,'roundRect',585,205,610,265,C.dark,C.mint); text(s,'SERVER-AUTHORITATIVE EVENT',620,235,540,25,18,C.mint,true,'left','Courier New');
  text(s,"socket.on('ping-quest', ({ command }) => {\n  const result = validateCommand(command);\n  io.to(roomId).emit('quest-result', result);\n  if (result.complete) io.to(roomId).emit('door-open');\n});",620,285,530,145,18,C.white,false,'left','Courier New');
  shape(s,'rect',75,525,1120,70,C.white,C.red); text(s,'TEST RESULT',100,545,160,22,16,C.red,true,'left','Courier New'); text(s,'Two browsers join one room → players move independently → both reach terminals → valid ping is broadcast → gateway unlocks.',285,545,850,25,18,C.ink,true);
  notes(s,'Project source code and implementation: public/game.js, public/index.html, public/styles.css. Architecture reference: Socket.IO documentation.'); }

// 7 — References
{ const s=deck.slides.add(); base(s,'REFERENCES','References and technical foundations.',7);
  const refs=[
    '[1] Borrego, C. et al. (2017). Room escape at class: Escape games activities to facilitate motivation and learning in computer science.',
    '[2] The Impact of a Digital Escape Room Focused on HTML and Computer Networks on Vocational High School Students. Education Sciences, 12(10), 682 (2022).',
    '[3] Socket.IO Documentation. https://socket.io/docs/v4/',
    '[4] Phaser Documentation. https://phaser.io/learn',
    '[5] Express.js Documentation. https://expressjs.com/',
    '[6] Prisma Documentation. https://www.prisma.io/docs/'
  ];
  refs.forEach((r,i)=>{const y=205+i*65; text(s,r,100,y,1040,42,17,i<2?C.ink:C.blue,false);});
  text(s,'Member names / student IDs: ________________________________',100,625,980,25,18,C.brown,true);
  notes(s,'[1] Borrego et al. (2017). [2] Education Sciences 12(10), 682 (2022). [3] Socket.IO docs. [4] Phaser docs. [5] Express docs. [6] Prisma docs.'); }

await fs.mkdir(`${OUT}/Rubric-7-Slides`, { recursive:true });
for (const [i,s] of deck.slides.items.entries()) {
  const png = await deck.export({ slide:s, format:'png', scale:1 });
  await fs.writeFile(`${OUT}/Rubric-7-Slides/slide-${String(i+1).padStart(2,'0')}.png`, new Uint8Array(await png.arrayBuffer()));
}
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(`${OUT}/Two-Rooms-One-Network-Rubric-7-Slides.pptx`);
