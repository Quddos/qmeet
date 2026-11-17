# LiveKit load test results (2026-11-17)

## Test environment
- Server: LiveKit server v1.13.11, built from source, running `--dev` on the same machine as the clients.
- Machine: 4 vCPU, 16 GB RAM, one VM. Clients and server shared the same CPUs, so these numbers are NOT a production capacity measurement.
- Clients: real WebRTC via `@livekit/rtc-node`. Teacher publishes audio and 320x180 video at 10 fps. Students auto-subscribe to the teacher's media.

## Results
| Run | Students requested | Connected | Failed | Notes |
|---|---|---|---|---|
| Smoke | 20 | 20 | 0 | audio frames flowing |
| Ramp | 50 | 50 | 0 | median connect 127 ms, p95 269 ms |
| Ramp | 100 | 100 | 0 | median connect 342 ms, p95 941 ms |
| Ramp | 200 (one process) | not recorded | - | client process hit the 200 s wall-clock limit before writing a result |
| Split | 200 (2 shards x 100) | 200 | 0 | median 463–487 ms, p95 ~3.0–3.5 s |
| Split | 400 (4 shards x 100 + teacher) | 311 | 89 | per shard: 82, 76, 75, 78; p95 connect 7–9 s; load average 13 on 4 cores |

Server CPU stayed at 10–28% and RSS at 0.4–1.0 GB during the tests. The 400 run failed on connection setup while the machine was saturated (load average 13 on 4 cores), so it does not show whether the server itself can hold 400.

## Conclusion
- The architecture works: real clients connected, received media, and stayed connected through 200 students on this machine.
- 400 concurrent participants are NOT yet verified. The result of 311/400 is a limit of the test box, not of the server.
- A valid 400 test needs the clients on separate machines from the server, and a server with dedicated CPU, bandwidth and UDP ports.

## Bandwidth estimate for a 400-person class (server egress)
- Teacher audio at about 40 kbps plus 320x180 video at about 150 kbps, times 400 viewers: about 80 Mbps.
- Teacher at 720p at about 1.5 Mbps, times 400 viewers: about 600 Mbps.
Cloudflare Realtime's free tier (1,000 GB/month) covers about 11 hours of 400-viewer audio+video at 720p per month... check the arithmetic against your real bitrates before choosing.

## Reproduce
See `tests/load/README.md`.
