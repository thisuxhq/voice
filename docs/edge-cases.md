# Edge cases

| Problem | Solution |
| ------- | -------- |
| Packet loss | Buffering / jitter buffer |
| Duplicate events | Event IDs |
| Network failure | Reconnection (`reconnecting` state) |
| Slow providers | Timeout handling |
| Hallucinations | Validation of tool args / structured outputs |
| Interruptions | State machine + abort paths |
| Context overflow | Summaries / sliding window |
| Provider failure | Failover / retries |

## Notes

- Event IDs are mandatory on every emit ([events.md](./events.md)).
- Reconnection keeps `session.id` stable ([session.md](./session.md)).
- Failover is post–Phase 1; Phase 1 surfaces hard failures via `error`.
