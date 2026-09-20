# Afterworld

Afterworld is a cloud hosted LLM platform built to explore how free language models perform under practical deployment conditions.

The project combines a web interface, a FastAPI backend, Azure App Service hosting, and OpenRouter as the model access layer. Its longer term purpose is to compare free LLMs not only by benchmark scores, but also by the conditions under which those models are actually accessed.

The central question is:

> **How do free LLMs compare when they are used through a rate limited, cloud hosted application?**

---

## I. Project Overview

Afterworld currently provides a web based interface for browsing and using free LLMs available through OpenRouter.

The application dynamically retrieves the available free chat models and presents information such as:

- Model and provider
- Context window
- Maximum output length
- Supported input types
- Reasoning support
- Model size
- AAII score, where available
- Free availability and expiration information

Models can be searched, filtered, and grouped by context size, model size, benchmark score, input type, and provider.

A model can then be selected for a dedicated conversation, with the selected model remaining fixed throughout that conversation.

---

## II. Project Objective

Afterworld is designed around a distinction between **model capability** and **service performance**.

A model may perform well on external benchmarks but still be difficult to use through a free endpoint because of rate limits, provider load, network conditions, or temporary unavailability.

The project therefore uses three layers:

```text
Model capability
        +
Inference service conditions
        +
Cloud deployment conditions
        =
Practical model performance
```

The current implementation establishes the platform needed for this comparison. Later versions will add controlled benchmark experiments and repeated measurements.

---

## III. System Architecture

Azure App Service is the primary hosting environment for Afterworld.

The application is intended to run as a publicly accessible cloud service rather than as a local-only application.

```text
                         USER
                          |
                          v
                 +------------------+
                 |   Web Browser     |
                 |   HTML / JS / CSS |
                 +--------+---------+
                          |
                          | HTTPS
                          v
                 +------------------+
                 |  Azure App       |
                 |  Service         |
                 |                  |
                 |  FastAPI backend  |
                 |  Static HTML frontend |
                 +--------+---------+
                          |
                          | OpenAI compatible API
                          v
                 +------------------+
                 |   OpenRouter     |
                 +--------+---------+
                          |
                          v
                 +------------------+
                 | Free LLM Provider |
                 | / Model Endpoint  |
                 +------------------+
```

### III.I Azure App Service

Azure App Service hosts the running FastAPI application and provides the public web endpoint.

The cloud server is responsible for:

- Serving the Afterworld frontend
- Running the FastAPI backend
- Communicating with OpenRouter
- Processing model metadata
- Handling chat requests
- Streaming model responses back to the browser
- Performing model availability and latency checks

The FastAPI application and frontend were deployed to the App Service, with the OpenRouter API key stored as an Azure application setting rather than inside the source code.
The B1 plan provided the initial paid compute environment for development. The F1 plan is used for the current lightweight deployment, with its resource and usage limits.

Azure App Service also provides the public azurewebsites.net endpoint used to access Afterworld over the internet.

This is also important for the later benchmarking work because cloud region and network routing can affect observed performance.

### III.II FastAPI Backend

`main.py` contains the backend application.

It handles:

- OpenRouter authentication
- Model catalog retrieval
- Free-model filtering
- Model metadata processing
- Endpoint status and latency information
- Random fast-model selection
- Chat requests
- Streaming responses
- Retry and error handling

The backend uses OpenRouter's OpenAI compatible API endpoint.

### III.III Frontend

`index.html` contains the complete web interface.

It provides:

- Model discovery
- Search
- Model grouping
- Capability filters
- Random fast-model selection
- Chat sessions
- Streaming responses
- Browser based chat history

Chat history is stored locally in the browser using `localStorage`.

---

## IV. Model Catalog

Afterworld does not maintain a manually updated list of models.

The backend retrieves the model catalog from OpenRouter and filters the response to retain currently available free chat models.

The filtering process excludes:

- Paid models
- Expired models
- Router aliases
- Non chat models
- Embedding models
- Rerankers
- Safety classifiers
- Models without suitable text chat support

Model information is then normalized into a format used by the frontend.

Parameter counts are only shown when they can be identified from information explicitly provided by the model, such as its model identifier, Hugging Face identifier, or description. The application does not invent missing parameter counts.

---

## V. Model Selection

Afterworld supports normal manual model selection as well as a **Random Fast Model** option.

The random selection process does not choose from every free model equally.

It first considers recent latency and endpoint health information, identifies a small pool of fast responding models, and then performs a live probe before selecting one.

```text
Free model catalog
        |
        v
Recent endpoint information
        |
        v
Healthy models
        |
        v
Fastest model group
        |
        v
Live response check
        |
        v
Selected model
```

Once a model is selected for a conversation, that model remains fixed for the conversation.

This prevents an automatic model switch from changing the conditions of a comparison midway through a chat.

---

## VI. Rate Limited Free Inference

Free model access introduces an additional experimental variable.

Availability can depend on:

- OpenRouter limits
- Provider limits
- Endpoint load
- Temporary service failures
- Model availability
- Request frequency

Afterworld handles common temporary API failures through retry logic while keeping the selected model unchanged.

This behavior is important for future experiments because switching to another model after a failure would make a comparison between models less controlled.

---

## VII. Current Benchmark Basis

The current interface displays the **Artificial Analysis Intelligence Index** when that information is available through OpenRouter.

The Intelligence Index is an external composite benchmark covering areas including agents, coding, general capability, and scientific reasoning. Artificial Analysis currently combines ten evaluations into the index and notes that individual benchmark results may be more useful for specific workloads.

Afterworld uses this score as **external benchmark metadata**.

It does not currently run the Artificial Analysis benchmark suite itself.

This distinction is important: the current system provides the platform and data required for comparison, while the controlled benchmarking system is part of future development.

---

## VIII. Benchmarking Roadmap

Future versions of Afterworld are intended to turn the platform into a controlled comparison environment for free LLMs.

### VIII.I Capability benchmarks

Models can be evaluated across task categories such as:

- General reasoning
- Mathematics
- Coding
- Knowledge
- Instruction following
- Scientific reasoning
- Long context tasks
- Multimodal tasks

External benchmark data can be used alongside task specific tests.

### VIII.II Latency benchmarks

The platform can later record:

- Time to first token
- Total response time
- Tokens per second
- Response length
- Latency distribution over repeated trials

The existing backend already includes a small live first output probe, but this is intended as an availability check rather than a complete performance benchmark.

### VIII.III Reliability benchmarks

Repeated requests can be used to measure:

- Successful responses
- Timeouts
- HTTP errors
- Rate limit responses
- Empty responses
- Successful response percentage

### VIII.IV Rate limit testing

Models can be tested under controlled request loads to study how free access behaves under increasing demand.

### VIII.V Cloud region testing

Because Afterworld is hosted through Azure App Service, the same application can later be deployed across different Azure regions.
This can be used to study how cloud location affects response time and user perceived performance.

### VIII.VI Category based comparison

The final benchmarking system is intended to avoid treating one model as universally superior.

Instead, results can be separated into categories such as:

```text
Reasoning
Coding
Speed
Reliability
Long context
Multimodal capability
Rate-limit resilience
Cloud latency
```

The purpose is to identify useful model choices within each category based on measured evidence.

---

## IX. Deployment

### IX.I Production environment

The primary deployment environment is:

```text
Azure App Service
        |
        v
FastAPI
        |
        v
OpenRouter
        |
        v
Free LLM endpoints
```

Azure App Service supports Python web applications including FastAPI and provides the hosting layer for the public Afterworld instance. For supported Python versions, App Service can run FastAPI directly; other versions may require a custom startup command.

A typical FastAPI deployment can use:

```bash
gunicorn -w 2 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 main:app
```

The exact startup configuration depends on the Python version and App Service configuration.

### IX.II Environment variables

The OpenRouter API key is provided through an environment variable:

```env
OPENROUTER_API_KEY=your_api_key_here
```

The key should be stored in Azure App Service configuration for the deployed application and should not be committed to the repository.

### IX.III Local development

Local execution is intended for development and testing.

```bash
uvicorn main:app --reload
```

The production application remains hosted through Azure App Service.

---

## X. Project Structure

```text
Afterworld/
│
├── main.py
├── static/
│   └── index.html
├── requirements.txt
├── .env
└── README.md
```

### `main.py`

FastAPI backend, OpenRouter integration, model processing, latency checks, model selection, retries, and response streaming.

### `index.html`

Frontend interface, model browser, filters, chat interface, browser-side chat storage, and streamed response rendering.

---

## XI. Limitations

The current version is not yet a full LLM benchmarking suite.

In particular:

- External benchmark scores are displayed rather than independently reproduced.
- The live latency probe is a small response check, not a full speed benchmark.
- There are no repeated controlled task evaluations yet.
- Tokens per second is not currently measured.
- Long term reliability statistics are not yet collected.
- Browser to Azure end-to-end latency is not separately recorded.
- Free model availability can change over time.
- Provider and rate-limit conditions can vary independently of model capability.

These limitations define the next stage of development rather than being hidden by a single overall score.

---

## XII. Development Roadmap

```text
Current
|
+-- Azure hosted application
+-- OpenRouter integration
+-- Dynamic free model catalog
+-- Model metadata and external benchmark display
+-- Model search and filtering
+-- Fixed-model conversations
+-- Streaming responses
+-- Latency aware random selection
|
v
Next
|
+-- Controlled benchmark prompts
+-- Repeated trials
+-- TTFT and generation speed
+-- Reliability statistics
+-- Rate-limit experiments
+-- Cloud region comparison
+-- Result storage
+-- Benchmark visualisation
|
v
Later
|
+-- Category based model comparison
+-- Historical performance tracking
+-- Automated benchmark runs
+-- Reproducible cloud benchmarking
```

---

## XIII. References

1. [OpenRouter API Documentation](https://openrouter.ai/docs)
   Model catalog, model metadata, API usage, pricing, and endpoints.

2. [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)
   Benchmark methodology and Intelligence Index information.

3. [Microsoft Azure App Service Documentation](https://learn.microsoft.com/en-us/azure/app-service/)
   Documentation for hosting Python web applications and FastAPI applications on Azure App Service.

---

## XIV. Project Status

**Afterworld is an active project focused on building a practical evaluation platform for free LLMs under cloud hosted and rate limited conditions.**

The current release establishes the application and deployment infrastructure. Future releases will add the controlled benchmarking and measurement layer required for systematic model comparisons.
