# ID Field Recognition

End-to-end OCR pipeline that extracts structured field data from US driver's license photos. Two custom-trained PyTorch models — one for ID localization, one for field-level text recognition — deployed on AWS SageMaker behind a serverless inference endpoint, with a browser-based capture UI.

**Status:** In development. See [Roadmap](#roadmap) for current phase.

**Live demo:** _(deployed link goes here once Phase 3 is complete)_

---

## What it does

A user takes a photo of their driver's license through the web app. The app sends the image to a SageMaker endpoint, which returns the structured field data — first name, last name, DOB, address, license number, expiration, and so on — and the form auto-populates. No typing required.

No data is stored at any stage. The user consents before scanning, the image lives in memory only during inference, and nothing is logged or persisted server-side.

## Why this project

Most production OCR systems use either off-the-shelf APIs (Textract, Google Vision) or fine-tuned foundation models. This project deliberately avoids both: the goal is to demonstrate the full ML lifecycle — synthetic data generation, custom model architecture, training infrastructure, and deployment — without leaning on pre-built recognition systems.

Constraints I imposed on myself:

- **No pre-built OCR.** Tesseract, Textract, EasyOCR, etc. were off-limits. The recognition model is a CRNN trained from scratch on synthetic data.
- **Pretrained CNN backbones allowed only for feature extraction.** The localization model uses a pretrained ResNet-18 backbone with a custom regression head trained from scratch. The CRNN backbone is fully custom.
- **No real ID data.** Collecting real driver's licenses is legally and ethically untenable. All training data is synthetic, generated to the AAMVA card design standard, which most US state licenses approximate.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────────┐
│   Browser   │────▶│ API Gateway  │────▶│     Lambda      │────▶│   SageMaker    │
│  (webcam +  │     │   (HTTPS)    │     │ (auth + routing)│     │   Endpoint     │
│   form UI)  │◀────│              │◀────│                 │◀────│  (serverless)  │
└─────────────┘     └──────────────┘     └─────────────────┘     └────────┬───────┘
                                                                          │
                                                            ┌─────────────┴─────────────┐
                                                            │                           │
                                                     ┌──────▼───────┐         ┌─────────▼────────┐
                                                     │ Localization │         │      CRNN        │
                                                     │   (ResNet-18 │ ──────▶ │  (text recog,    │
                                                     │  + corners)  │  crops  │   CTC loss)      │
                                                     └──────────────┘         └──────────────────┘
```

### Inference pipeline

1. Browser uploads a photo of an ID through the `/scan` endpoint.
2. API Gateway routes the request to a Lambda function for auth and payload validation.
3. Lambda invokes the SageMaker serverless endpoint with the image bytes.
4. Inside the endpoint container:
    - **Model 1 (Localization)** predicts the four corners of the ID in the photo.
    - OpenCV's perspective transform warps the ID to a canonical 1012×638 rectangle.
    - The canonicalized ID is cropped into 16 fixed field regions.
    - **Model 2 (CRNN)** runs on all 16 crops in a single batched forward pass.
    - Post-processing validators normalize formats (dates, license numbers).
5. The endpoint returns structured JSON.
6. The browser populates the form.

End-to-end latency: ~1–2 seconds warm, ~5–7 seconds on serverless cold start.

## Models

### Model 1: ID Localization

- **Task:** Given a photo, predict the (x, y) coordinates of the ID's four corners.
- **Architecture:** ResNet-18 backbone (pretrained on ImageNet), custom regression head outputting 8 values.
- **Loss:** Mean squared error.
- **Training data:** ~80k synthetic IDs composited onto random backgrounds with perspective warps.
- **Held-out accuracy:** _(corner localization error in pixels — fill in after training)_

### Model 2: CRNN Field Recognition

- **Task:** Given a small image crop of one field, predict the text string.
- **Architecture:**
    - Custom CNN feature extractor (7 conv layers, reduces height to 1, preserves width as sequence dimension)
    - Bidirectional LSTM (2 layers, 256 hidden units per direction)
    - Linear projection to alphabet size + CTC blank token
- **Loss:** CTC (Connectionist Temporal Classification).
- **Training data:** ~1.6M field crops (16 fields × 100k synthetic IDs).
- **Held-out character accuracy:** _(fill in after training)_
- **Held-out field-level exact match:** _(fill in after training)_

## Synthetic data pipeline

The most front-loaded part of the project. Lives in `data_generation/`.

- **Layout:** A single AAMVA-structured fictional ID design with all standard field codes (DAQ, DAC, DAA, DBB, DBA, DBD, DBC, DAU, DAW, DAY, DAG, DAI, DAJ, DAK, DCA).
- **Field randomization:** [Faker](https://faker.readthedocs.io/) for realistic-looking names, addresses, and dates. Custom generators for license numbers, height/weight/eye color matching real ID conventions.
- **Visual randomization:** Background colors, photo placeholders, font choices within a curated set, slight position jitter on each field.
- **Augmentation:** Perspective warps, glare hotspots, motion blur, JPEG compression artifacts, lighting shifts, partial shadows, partial occlusion, random backgrounds for the localization task.
- **Ground truth:** Each generated image ships with a JSON sidecar containing every field's text and pixel-precise bounding box.

100k images take ~3 hours to generate on a single laptop CPU.

## Tech stack

- **ML:** PyTorch, torchvision, OpenCV, Pillow, Faker
- **Training:** SageMaker Training Jobs (spot instances, ml.g4dn.xlarge)
- **Inference:** SageMaker Serverless Inference, Lambda, API Gateway
- **Storage:** S3 (training data, model artifacts)
- **Frontend:** Vanilla JS, HTML5 getUserMedia API, no framework
- **IaC:** _(Terraform or CDK — fill in once deployment is automated)_

## Design decisions

A few choices that aren't obvious from the architecture diagram:

**Two models instead of one end-to-end model.** A single model that takes a photo and outputs all 16 fields directly would be cleaner architecturally but harder to train, harder to debug, and harder to explain. Factoring into localization + recognition lets each model have a narrowly-defined task and lets them be trained, tested, and improved independently. The deterministic crop step in the middle is the key — once the ID is canonicalized, field positions are known, so no ML is wasted on a problem that's solved by knowing the layout.

**CRNN + CTC instead of attention-based decoder.** Modern STR (scene text recognition) papers favor attention-based or transformer decoders. CRNN+CTC is older but a better fit here: smaller, faster to train on a portfolio budget, well-documented, and the architecture maps cleanly onto how I want to explain the model in interviews. The accuracy ceiling is lower than SOTA, but well above what's needed for high-accuracy structured-document recognition.

**Synthetic data over weak supervision.** An alternative path was bootstrapping: run an off-the-shelf OCR (e.g., Textract) on real IDs, hand-correct the outputs, and use those as training labels. I rejected this because (a) it requires real ID data I can't legally obtain, and (b) it caps my model's accuracy at the labeling model's accuracy. Synthetic data gives me perfect ground truth at zero labeling cost.

**Serverless inference over real-time endpoints.** A real-time SageMaker endpoint runs ~$84/month even when idle. Serverless inference scales to zero, costs cents per month at portfolio demo traffic, and adds only ~5 seconds of cold-start latency on the first request — acceptable for this use case.

**Pretrained backbone for localization, not for recognition.** Localization is a generic visual task (find a rectangular object) where ImageNet features transfer well. Recognition is highly specific (read text in a known font set on cards) where pretrained features are less useful and the project goal is to demonstrate training a recognizer from scratch.

## Privacy

- Images are not stored. They live in memory during the ~1-second inference window and are discarded.
- No logging of image contents or extracted field data — only operational metrics (latency, error rate) go to CloudWatch.
- The user is shown a consent screen before the camera activates and must opt in.
- The app runs over HTTPS end-to-end; the SageMaker endpoint is invoked from inside AWS only.

## Repository structure

```
.
├── data_generation/         # Synthetic ID generator (Phase 0)
│   ├── generate_id.py       # Single-image generator
│   ├── augment.py           # Augmentation pipeline
│   ├── batch_generate.py    # Bulk dataset creation
│   └── fonts/, assets/      # Rendering resources
├── models/
│   ├── localization/        # ResNet-18 + corner regression head
│   └── crnn/                # CRNN architecture and CTC training
├── training/
│   ├── train_localization.py
│   ├── train_crnn.py
│   └── sagemaker_launch.py  # Job submission scripts
├── inference/
│   ├── handler.py           # SageMaker inference container entrypoint
│   └── postprocess.py       # Field validators (date format, etc.)
├── infra/
│   ├── lambda/              # API Gateway → SageMaker proxy
│   └── terraform/           # AWS resources as code
├── webapp/
│   ├── index.html           # Capture UI + consent flow
│   ├── style.css
│   └── script.js            # Camera + API integration
└── README.md
```

## Roadmap

- [ ] Phase 0a — Minimum viable ID generator (one layout, no augmentation)
- [ ] Phase 0b — Field randomization + JSON ground truth
- [ ] Phase 0c — Augmentation pipeline + 100k dataset
- [ ] Phase 1 — Localization model
- [ ] Phase 2 — CRNN model
- [ ] Phase 3 — SageMaker deployment
- [ ] Phase 4 — Web app integration
- [ ] Phase 5 — Documentation + deployed demo

## What I learned

_(Fill in after each phase. This is the section recruiters actually read.)_

## Limitations and honest caveats

- The model is trained on synthetic data approximating the AAMVA standard. It generalizes to real US licenses well enough for a demo but won't match production OCR systems trained on millions of real samples.
- Heavy glare, severe perspective distortion, or non-AAMVA licenses (e.g., older designs, non-US documents) will fail.
- Field-level exact match is more useful than character accuracy as a metric — _(percent)_ of fields are returned exactly correct on the held-out synthetic test set, lower on real-world photos.
- Cold start latency on serverless inference can spike to 5–7 seconds for the first request after idle.

## Running locally

_(Fill in once the project is reproducible end-to-end.)_

```bash
git clone https://github.com/<your-handle>/id-field-recognition
cd id-field-recognition
pip install -r requirements.txt

# Generate a small synthetic dataset
python data_generation/batch_generate.py --count 1000 --output data/sample/

# Train localization (locally, CPU, small dataset)
python training/train_localization.py --data data/sample/ --epochs 5

# Train CRNN
python training/train_crnn.py --data data/sample/ --epochs 5
```

## License

_(MIT)_

## Contact

_(Adeyneous Kpoto, Teddykpoto@gmail.com,https://www.linkedin.com/in/adeyneous-kpoto-84021a199/, https://www.adeyneouskpoto.com/.)_
