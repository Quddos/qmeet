# LiveKit load test

Real WebRTC clients (via `@livekit/rtc-node`) join one room: one teacher publishes 48 kHz audio and a 320x180 video at 10 fps; students auto-subscribe to the teacher's media. This measures the media server, not the API.

Setup (on a machine separate from the LiveKit server, so client CPU does not distort server results):

    cd tests/load && npm init -y && npm install @livekit/rtc-node livekit-server-sdk
    LK_KEY=<api key> LK_SECRET=<api secret> node livekit-load.mjs --url wss://<your-livekit> --students 100 --duration 120 --room test-1 --shard a --teacher 1
    # other shards: same --room, --teacher 0

Run one process per ~100 students. Output is one JSON line per shard.
