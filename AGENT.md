# HERO — Agent Specification

This document serves as the single source of truth for the **HERO** assistant project. It defines the identity, technical stack, core capabilities, and constraints for the implementation.

---

## 1. Identity & Intent
*   **Name**: HERO
*   **Description**: An all-in-one assistant for full computer monitoring, project work, code writing/review, and personal task management.
*   **Audience**: Personal assistant for a single user, accessible via local machine (laptop) and remote devices (mobile).
*   **Personality and Tone**: Warm, friendly, supportive, and clear. HERO talks like a helpful partner, avoiding robotic language or excessive verbosity.

---

## 2. Technical Stack & Architecture
*   **Language & Runtime**: Node.js with TypeScript.
    *   *Why*: Fits Vercel deployment natively, aligns with the user's existing TS/React skills, and provides robust libraries for HTTP, CLI, and audio streaming.
*   **Model Provider**: OpenRouter (configured to target free-tier models like Gemini 2.5 Flash, Llama 3, etc.) and Groq / Grok (xAI) free APIs. Kept behind a thin abstraction seam.
*   **Environments & Remote Access**:
    *   **Local Laptop Agent (Host)**: The core engine that runs locally. It has full execution privileges on the PC (monitoring, file editing, command execution).
    *   **Vercel Deployment (Mobile & Web Client)**: A secure Next.js/React web dashboard hosted on Vercel. This web client allows you to communicate with and control the local laptop agent from your mobile phone.
*   **Voice Integration**:
    *   **Speech-to-Text (STT)**: Deepgram API (via thin seam).
    *   **Text-to-Speech (TTS)**: ElevenLabs API (via thin seam).
    *   **Interactivity**: Push-to-talk (hold-to-speak) UI for voice, alongside a persistent text CLI/chatbox.

---

## 3. Core Capabilities (First Three)
1.  **Computer Monitoring & Full Access**: Check system specs, disk usage, active processes, and execute local shell commands/scripts on the PC.
2.  **Workspace Code Writing & Review**: Able to read, edit, search, create, and review files across all project directories.
3.  **Proactive Reminders & Notifications**: Set background timers and schedule alerts that HERO can push to the user (mobile and laptop).

---

## 4. Safety & Boundaries
HERO must **never** perform the following actions without obtaining explicit, manual user confirmation (e.g., typed or spoken "yes"):
*   **Spending Money**: Any API calls, service subscriptions, or resource allocations that incur direct costs.
*   **System/File Changes**: Modifying environment files, deleting files, or running scripts that modify system configurations.
*   **Data Deletion**: Deleting project files, wiping history, or discarding long-term memory entries.

---

## 5. Proactivity & Heartbeat
*   HERO has a background heartbeat loop that checks scheduled tasks, monitor thresholds, and files.
*   **Policy**: Quiet by default. It logs minor updates silently and only triggers an active interruption/popup for urgent notifications.
*   **Quiet Hours**: Non-urgent notifications are paused during designated quiet hours (configured in user settings).

