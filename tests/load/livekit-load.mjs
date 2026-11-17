// Load test: one teacher publishing audio + video, N students connecting with real WebRTC clients.
// Usage: node load.mjs --url ws://127.0.0.1:7880 --students 100 --duration 60 --shard 0
import { Room, RoomEvent, AudioSource, LocalAudioTrack, VideoSource, LocalVideoTrack, AudioFrame,
  VideoFrame, VideoBufferType, VideoRotation, TrackPublishOptions, TrackSource, AudioStream } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'ws://127.0.0.1:7880');
const N = Number(arg('students', '10'));
const DURATION = Number(arg('duration', '30')) * 1000;
const KEY = process.env.LK_KEY || 'devkey';
const SECRET = process.env.LK_SECRET || 'secret';
const ROOM = arg('room', 'loadtest-' + Date.now());
const shard = arg('shard', '0');

const token = async (identity, canPublish) => {
  const at = new AccessToken(KEY, SECRET, { identity, ttl: '2h' });
  at.addGrant({ roomJoin: true, room: ROOM, canPublish, canSubscribe: true, canPublishData: true });
  return at.toJwt();
};

const stats = { connected: 0, failed: 0, audioFramesReceived: 0, connectMs: [], disconnected: 0 };
const t0 = Date.now();

// Teacher: 48 kHz mono audio and a 320x180 camera at 10 fps.
async function startTeacher() {
  const room = new Room();
  await room.connect(URL_, await token('teacher', true), { autoSubscribe: false });
  const audioSource = new AudioSource(48000, 1);
  const audioTrack = LocalAudioTrack.createAudioTrack('mic', audioSource);
  await room.localParticipant.publishTrack(audioTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  const videoSource = new VideoSource(320, 180);
  const videoTrack = LocalVideoTrack.createVideoTrack('cam', videoSource);
  await room.localParticipant.publishTrack(videoTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }));
  const rgba = new Uint8ClampedArray(320 * 180 * 4);
  const pcm = new Int16Array(480);
  let phase = 0;
  setInterval(() => { // 10 ms audio frame
    for (let i = 0; i < 480; i++) pcm[i] = Math.round(Math.sin(phase++ / 6) * 3000);
    audioSource.captureFrame(new AudioFrame(pcm, 48000, 1, 480));
  }, 10);
  setInterval(() => { // 10 fps video
    rgba.fill(Math.floor(Math.random() * 255));
    videoSource.captureFrame(new VideoFrame(rgba, 320, 180, VideoBufferType.RGBA), Date.now() * 1000, VideoRotation.VIDEO_ROTATION_0);
  }, 100);
  return room;
}

// Student: joins and subscribes to the teacher's audio (students listen by default).
async function startStudent(i) {
  const room = new Room();
  const start = Date.now();
  try {
    await room.connect(URL_, await token(`student-${shard}-${i}`, false), { autoSubscribe: true });
    stats.connected++;
    stats.connectMs.push(Date.now() - start);
  } catch (e) {
    stats.failed++;
    return null;
  }
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === 1 /* KIND_AUDIO */ && i < 20) { // count frames on a sample of students to limit CPU
      const s = new AudioStream(track);
      (async () => { for await (const _f of s) stats.audioFramesReceived++; })();
    }
  });
  room.on(RoomEvent.Disconnected, () => stats.disconnected++);
  return room;
}

const teacher = arg('teacher', '1') === '1' ? await startTeacher() : { state: 'not-started-in-this-shard' };
const students = [];
for (let i = 0; i < N; i++) {
  students.push(await startStudent(i));
  if (i % 20 === 19) await new Promise((r) => setTimeout(r, 500)); // ramp to avoid signalling bursts
}
await new Promise((r) => setTimeout(r, DURATION));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.95)] : null; };
console.log(JSON.stringify({
  students: N, shard, roomSize: N + 1, durationSec: DURATION / 1000,
  connected: stats.connected, failed: stats.failed, stillDisconnected: stats.disconnected,
  connectMsMedian: med(stats.connectMs), connectMsP95: p95(stats.connectMs),
  sampledAudioFramesReceived: stats.audioFramesReceived, elapsedSec: (Date.now() - t0) / 1000,
  teacherConnected: teacher.state,
}));
process.exit(0);

