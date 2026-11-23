# ErgoSafe

An installable web app (PWA) for workplace risk management, built for the
Advanced Human Factors course. Domain: **Intelligent & Autonomous Management Systems**.

It assesses the two most common physical risks at work, and tells the
supervisor what to change for each worker:

| Module | What it does | Level of the User vs Work graph |
|---|---|---|
| Workers | Stature → Indian population percentile, body dimensions, recommended work-surface / seat / screen heights and reach zones | Anthropometry |
| Posture | Photo or live camera → in-browser pose detection → joint angles (editable) → **RULA** and **REBA** scores, body map, worked score breakdown, specific fixes | Biomechanics |
| Noise | Phone microphone → A-weighted sound level, calibration, daily dose and TWA (NIOSH and Indian Factories Act), hearing-protector NRR, control measures | Information handling / Functional |
| Home | Risk dashboard ranking every assessment, CSV/JSON export | Information handling / Functional |
| Feedback | System Usability Scale + look-and-feel ratings | Aesthetic |

## Run locally

```
python -m http.server 8000
```
then open http://localhost:8000. Camera and microphone need `localhost` or HTTPS.

## Privacy

Nothing is uploaded. Pose detection runs in the browser (Google MediaPipe);
all data is stored in the browser's local storage on the device.

## Main references

- McAtamney & Corlett (1993), RULA, *Applied Ergonomics* 24(2)
- Hignett & McAtamney (2000), REBA, *Applied Ergonomics* 31(2)
- NIOSH (1998), *Criteria for a Recommended Standard: Occupational Noise Exposure*
- Factories Act 1948 (India), model rules on noise exposure
- Chakrabarti (1997), *Indian Anthropometric Dimensions for Ergonomic Design Practice*, NID
- Grandjean, *Fitting the Task to the Man* (work-surface heights)
- Brooke (1996), SUS — A quick and dirty usability scale
