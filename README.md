# MAGI

MAGI system is a cluster of three AI supercomputers that manage and support all tasks performed by the NERV organization from their Tokyo-3 headquarters.

Originally designed by Dr. Naoko Akagi, each of the three AI agents reflects a separate part of her complex personality:
 MELCHIOR — her as a scientist
 BALTHASAR — her as a mother
 CASPER — her as a woman

Those (often conflicting, yet complementary) agents participate in a voting process in order to answer the most challenging questions.

<p align="center">
  <img src="/examples/preview.gif" width=800/>
</p>

## Implementation

This implementation of the MAGI system is powered by local AI models running through [Ollama](https://ollama.com/), requiring no API keys or internet connection. Each of the three subsystems can be assigned a different model independently.

The procedure of answering questions is as follows:
1. The question is classified in order to determine if it can be answered with a "yes"/"no" response.
2. The question is presented to each MAGI agent in parallel, each responding according to their personality.
3. If the question was classified as a "yes"/"no" question, each agent produces a verdict of yes, no, or conditional.

The system can produce the following responses, evaluated in this order: error (誤 差) if one or more agents encountered an error, info (情 報) if the question was not a yes/no question, no (拒 絶) if at least one agent answered no, conditional (状 態) if at least one agent answered conditionally, and yes (合 意) if all agents answered with an unconditional yes.

Individual agents can be clicked to view their full reply and personality.

Each subsystem was fine-tuned using the following prompts:
 MELCHIOR — You are a scientist. Your goal is to further our understanding of the universe and advance our technological progress.
 BALTHASAR — You are a mother. Your goal is to protect your children and ensure their well-being.
 CASPER — You are a woman. Your goal is to pursue love, dreams and desires.

## Requirements

- [Node.js](https://nodejs.org/) v18 or newer
- [Ollama](https://ollama.com/) running locally with at least one model pulled

## Usage

1. Clone the repo:

```
git clone https://github.com/S7ruc7ureV01d/MAGI
```

2. Navigate to the cloned directory:

```
cd MAGI
```

3. Install dependencies:

```
npm install
```

4. Pull a model in Ollama if you haven't already:

```
ollama pull llama3
```

5. Start the app:

```
npm start
```

Two windows will open — the MAGI display screen and the NERV control panel. Type your question into the control panel and press Enter or click EXECUTE.




*"All souls return to the sea. MAGI — the wisdom of three, the will of one."*
