# Submission and demo checklist

- [ ] Correct repository and `main` branch; baseline `8cb2e54` or the explicitly approved successor.
- [ ] Review `git status`; commit/push final documentation only when separately authorized. Before submission, verify the intended final commit is on the remote and the working tree is clean.
- [ ] Node/pnpm/Java and `.env.local` ready; Firebase emulator mode selected.
- [ ] Auth, Firestore, RTDB, Functions and frontend running on documented ports.
- [ ] Fake admin login ready; app and Emulator UI open.
- [ ] Saved train/route/schedule visible; fresh current-time generated journey selected (not the manual compatibility journey).
- [ ] Demonstrate SCHEDULED, then explicitly reconcile READY locally.
- [ ] Shared simulator device is available; Start works.
- [ ] Fake tickets and temporary subscriptions imported before boarding stations are passed.
- [ ] Passenger map, tile/network access and simulator Step/Hold controls ready.
- [ ] ETA/delay → Mock SMS demonstrated; repeated updates produce no duplicate alert.
- [ ] Manual subscription survives refresh and can be cancelled.
- [ ] Complete demonstrated; passenger terminal state, no active ETA and inactive subscriptions shown.
- [ ] Optional separate cancellation and device reuse demonstrated.
- [ ] Read [demo guide](DEMO_GUIDE.md); rehearse the sequence before evaluation.
- [ ] Report recorded tests honestly, including the fixed-time completion fixture limitation; do not claim all integrations consistently pass.
- [ ] Explain simulated geometry/GPS, Mock SMS, non-ML ETA and non-official status.
- [ ] Save emulator export on orderly shutdown; no production deployment needed.
