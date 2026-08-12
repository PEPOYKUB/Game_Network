const socket = io();
let mySide = 'left';
let gameScene;
const $ = (id) => document.getElementById(id);
const STAGES = [
  { name: 'ROOM 01 // ICMP HANDSHAKE', prompt: 'ตรวจสอบว่า host อีกห้องตอบสนองบนเครือข่ายหรือไม่', hint: 'ส่ง ICMP echo ไปยัง peer address', command: 'ping 10.0.0.2' },
  { name: 'ROOM 02 // ROUTING BLACKHOLE', prompt: 'ค้นหาเส้นทางที่ packet หายระหว่าง VLAN 20 และ VLAN 30', hint: 'trace route ไปยัง service ปลายทางเพื่อดู hop ที่เสีย', command: 'traceroute 10.30.0.10' },
  { name: 'ROOM 03 // DNS SERVICE DISCOVERY', prompt: 'ค้นหา gateway service จาก DNS ภายในก่อนเปิดทางออก', hint: 'ถาม DNS resolver ของ lab ด้วยชื่อ gateway service', command: 'nslookup gateway.lab' }
];

function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800); }

class RoomScene extends Phaser.Scene {
  constructor() { super('RoomScene'); }
  create() {
    gameScene = this; this.doorOpen = false; this.activeTerminal = false; this.lastSent = 0; this.walkClock = 0; this.facing = 1;
    this.drawWorld();
    this.player = this.add.rectangle(220, 470, 20, 30, 0x5be2d0).setVisible(false).setDepth(20);
    this.character = null; this.remoteCharacter = null; this.keys = this.input.keyboard.addKeys('W,A,S,D');
    this.input.keyboard.on('keydown-E', () => { if (this.activeTerminal && !this.doorOpen) openCmd(); else if (this.atGate && this.doorOpen) socket.emit('advance-room', res => toast(res?.waiting ? 'รอเพื่อนมาที่ Gateway...' : (res?.error || 'กำลังไปห้องถัดไป'))); });
    this.input.keyboard.on('keydown-ESC', closeCmd);
    this.setCharacter('/assets/character-left.png');
  }
  drawWorld() {
    const g = this.add.graphics();
    g.fillStyle(0x111a25).fillRect(0, 0, 1600, 900);
    this.drawRoom(g, 35, 70, 725, 760, 0x172b3b, 0x1e4d5c, 'ROOM 01 // LOCAL NODE');
    this.drawRoom(g, 840, 70, 725, 760, 0x241d36, 0x563866, 'ROOM 02 // REMOTE NODE');
    g.fillStyle(0x0b1119).fillRect(760, 0, 80, 900);
    for (let y = 80; y < 840; y += 80) g.lineStyle(2, 0x243544).lineBetween(770, y, 830, y + 38);
    this.door = this.add.rectangle(800, 450, 64, 220, 0x0a1018).setStrokeStyle(3, 0x5be2d0).setDepth(8);
    this.doorLabel = this.add.text(800, 450, 'LOCKED\nLINK', { fontFamily: 'monospace', fontSize: '13px', color: '#5be2d0', align: 'center' }).setOrigin(.5).setDepth(9);
    this.doorGlow = this.add.rectangle(800, 450, 76, 235, 0x5be2d0, .08).setDepth(7);
    this.add.text(800, 42, 'INTER-ROOM GATEWAY', { fontFamily: 'monospace', fontSize: '13px', color: '#71828d', letterSpacing: 3 }).setOrigin(.5).setDepth(5);
    this.roomLeftLabel = this.add.text(215, 130, STAGES[0].name, { fontFamily: 'monospace', fontSize: '11px', color: '#6ce4d3' }).setDepth(5);
    this.roomRightLabel = this.add.text(1375, 130, 'REMOTE NODE', { fontFamily: 'monospace', fontSize: '11px', color: '#de9bff' }).setDepth(5);
    this.terminals = [{ x: 570, y: 470, side: 'left' }, { x: 1030, y: 470, side: 'right' }];
    this.terminals.forEach(t => { t.base = this.add.rectangle(t.x, t.y, 82, 62, 0x0a131d).setStrokeStyle(3, t.side === 'left' ? 0x5be2d0 : 0xd58aff).setDepth(6); t.screen = this.add.rectangle(t.x, t.y - 5, 54, 28, 0x142c38).setStrokeStyle(1, 0x92fff0).setDepth(7); t.icon = this.add.text(t.x, t.y - 5, '>_', { fontFamily: 'monospace', fontSize: '16px', color: t.side === 'left' ? '#5be2d0' : '#de9bff' }).setOrigin(.5).setDepth(8); t.label = this.add.text(t.x, t.y + 54, 'NETWORK TERMINAL', { fontFamily: 'monospace', fontSize: '10px', color: '#a8b7be' }).setOrigin(.5).setDepth(8); this.tweens.add({ targets: t.screen, alpha: .55, duration: 700, yoyo: true, repeat: -1 }); });
    for (let x = 95; x < 1510; x += 75) for (let y = 180; y < 760; y += 110) this.add.circle(x, y, 2, 0x6ce4d3, .22).setDepth(2);
    this.add.text(800, 865, 'WASD  MOVE     E  ACCESS TERMINAL     ESC  CLOSE CONSOLE', { fontFamily: 'monospace', fontSize: '12px', color: '#71828d' }).setOrigin(.5).setDepth(5);
  }
  drawRoom(g, x, y, w, h, fill, stroke, label) { g.fillStyle(fill).fillRect(x, y, w, h); g.lineStyle(3, stroke).strokeRect(x, y, w, h); for (let px=x+30;px<x+w-20;px+=120){g.lineStyle(1, stroke, .45).lineBetween(px,y+25,px,y+h-25);} for (let py=y+30;py<y+h;py+=110){g.lineStyle(1, stroke, .3).lineBetween(x+20,py,x+w-20,py);} this.add.text(x+28,y+25,label,{fontFamily:'monospace',fontSize:'14px',color:'#d9e5e8'}).setDepth(5); }
  loadCharacterTexture(key, src, done) { const image=new Image(); image.onload=()=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const px=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<px.data.length;i+=4)if(px.data[i]>242&&px.data[i+1]>242&&px.data[i+2]>242)px.data[i+3]=0;ctx.putImageData(px,0,0);let minX=c.width,minY=c.height,maxX=0,maxY=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(px.data[(y*c.width+x)*4+3]>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}const crop=document.createElement('canvas');crop.width=maxX-minX+1;crop.height=maxY-minY+1;crop.getContext('2d').drawImage(c,minX,minY,crop.width,crop.height,0,0,crop.width,crop.height);if(this.textures.exists(key))this.textures.remove(key);this.textures.addCanvas(key,crop);done(crop.width/crop.height);};image.src=src; }
  setCharacter(src) { this.loadCharacterTexture('hero',src,ratio=>{if(this.character)this.character.destroy();this.character=this.add.image(this.player.x,this.player.y-55,'hero').setDisplaySize(115*ratio,115).setDepth(20);}); }
  setRemoteCharacter(src) { this.loadCharacterTexture('remote',src,ratio=>{if(this.remoteCharacter)this.remoteCharacter.destroy();this.remoteCharacter=this.add.image(1370,470,'remote').setDisplaySize(105*ratio,105).setDepth(19).setVisible(this.doorOpen);}); }
  updateRemote(remote) { if(!this.remoteCharacter || !remote) return; this.remoteCharacter.x=Number(remote.x)||1370; this.remoteCharacter.y=(Number(remote.y)||470)-55; this.remoteCharacter.setVisible(this.doorOpen); }
  setStage(stage) { const data=STAGES[stage]||STAGES[0]; this.stage=stage; if(this.roomLeftLabel)this.roomLeftLabel.setText(data.name); if(this.roomRightLabel)this.roomRightLabel.setText(`ROOM ${String(stage+1).padStart(2,'0')} // REMOTE DATA`); }
  resetPosition() { this.player.x=mySide==='left'?220:1380; this.player.y=470; }
  setSide(side) { mySide=side; this.player.x=side==='left'?220:1380; this.player.y=470; this.setCharacter(side==='left'?'/assets/character-left.png':'/assets/character-right.png'); this.setRemoteCharacter(side==='left'?'/assets/character-right.png':'/assets/character-left.png'); }
  setDoor(open) { if(this.doorOpen===open)return; this.doorOpen=open; if(open){this.door.setVisible(false);this.doorLabel.setText('LINK\nOPEN').setColor('#5be2d0');this.doorGlow.setFillStyle(0x5be2d0,.26);if(this.remoteCharacter)this.remoteCharacter.setVisible(true);toast('LINK ESTABLISHED // ประตูเปิดแล้ว เดินไปหาเพื่อนได้');} else {this.door.setVisible(true);this.doorLabel.setText('LOCKED\nLINK');} }
  update(time) { if(!$('cmd-dialogue').classList.contains('hidden'))return; const k=this.keys;const ox=this.player.x,oy=this.player.y;const speed=3;if(k.A.isDown)this.player.x-=speed;if(k.D.isDown)this.player.x+=speed;if(k.W.isDown)this.player.y-=speed;if(k.S.isDown)this.player.y+=speed;const minX=55,maxX=1545;this.player.x=Phaser.Math.Clamp(this.player.x,minX,maxX);if(!this.doorOpen){if(mySide==='left')this.player.x=Math.min(this.player.x,720);else this.player.x=Math.max(this.player.x,880);}this.player.y=Phaser.Math.Clamp(this.player.y,170,760);const walking=ox!==this.player.x||oy!==this.player.y;if(walking){this.walkClock+=.22;this.facing=this.player.x>=ox?1:-1;if(time-this.lastSent>70){socket.emit('player-move',{x:this.player.x,y:this.player.y});this.lastSent=time;}}if(this.character){this.character.x=this.player.x;this.character.y=this.player.y-55+(walking?Math.sin(this.walkClock)*3:0);this.character.angle=walking?Math.sin(this.walkClock)*2:0;this.character.setFlipX(this.facing<0);}const terminal=this.terminals.find(t=>t.side===mySide);const near=Phaser.Math.Distance.Between(this.player.x,this.player.y,terminal.x,terminal.y)<125;this.activeTerminal=near&&!this.doorOpen;this.atGate=this.doorOpen&&Math.abs(this.player.x-800)<135;terminal.base.setStrokeStyle(near?4:3,near?0xffc56b:(terminal.side==='left'?0x5be2d0:0xd58aff));terminal.label.setColor(near?'#ffcf79':'#a8b7be');}
}

function openCmd(){ const data=STAGES[gameScene?.stage||0];$('cmd-dialogue').classList.remove('hidden');$('cmd-input').value='';$('cmd-input').placeholder=data.command;$('cmd-result').textContent='';$('cmd-dialogue').querySelector('.cmd-title').textContent=data.name;$('cmd-dialogue').querySelector('.cmd-body p').textContent=data.prompt;$('cmd-dialogue').querySelector('.cmd-output').innerHTML=`<span>guest@node:~$</span> route ready<br><span>guest@node:~$</span> ${data.hint}`;$('cmd-input').focus(); }
function closeCmd(){ $('cmd-dialogue').classList.add('hidden'); }
function renderState(state){ const nextStage=state.stage||0;const stageChanged=gameScene&&gameScene.stage!==nextStage;if(gameScene){gameScene.setStage(nextStage);if(stageChanged)gameScene.resetPosition();gameScene.setDoor(state.doorOpen);} $('door-status').textContent=state.doorOpen?'DOOR OPEN':'DOOR LOCKED';$('door-status').style.color=state.doorOpen?'var(--cyan)':'var(--orange)';$('side-label').textContent=`ROOM ${String(nextStage+1).padStart(2,'0')} // ${mySide.toUpperCase()}`;const me=state.players.find(p=>p.id===socket.id);const remote=state.players.find(p=>p.id!==socket.id);$('ping-status').textContent=state.pinged.includes(socket.id)?'ACK RECEIVED':'NOT SENT';if(me&&mySide!==me.side){mySide=me.side;gameScene?.setSide(me.side);}if(remote)gameScene?.updateRemote(remote); }

$('join').onclick=()=>socket.emit('join-room',{name:$('name').value,roomCode:$('room').value},res=>{if(res.error)return alert(res.error);mySide=res.side;$('room-label').textContent=res.roomCode;$('side-label').textContent=`${res.side.toUpperCase()} ROOM`;$('lobby').classList.add('hidden');$('game').classList.remove('hidden');gameScene?.setSide(res.side);toast('เดินไปหา NETWORK TERMINAL แล้วกด E');});
$('cmd-form').onsubmit=e=>{e.preventDefault();const command=$('cmd-input').value;socket.emit('ping-quest',{command},res=>{if(res.valid){$('cmd-result').textContent=res.doorOpen?'[ OK ] REPLY FROM PARTNER // GATE UNLOCKED':'[ OK ] PACKET SENT // รออีกคนตอบกลับ';$('cmd-result').className='cmd-ok';}else{$('cmd-result').textContent=`[ ERROR ] expected: ${STAGES[gameScene?.stage||0].command}`;$('cmd-result').className='cmd-error';}});};
$('cmd-close').onclick=closeCmd;
socket.on('state',renderState);socket.on('connect',()=>$('connection').textContent='● CONNECTED');socket.on('disconnect',()=>{$('connection').textContent='● OFFLINE';$('connection').style.color='var(--red)';});
if(window.Phaser)new Phaser.Game({type:Phaser.CANVAS,parent:'phaser-game',width:1600,height:900,backgroundColor:'#111a25',scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:false,roundPixels:true},scene:RoomScene});
