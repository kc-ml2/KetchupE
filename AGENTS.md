# Project Context

This is an **internal LLM-based application** used within the company.
The service is primarily a **chatbot**, integrated with:

- Internal document RAG
- Multiple AI agents

The UI consists of:

- **Sidebar**: feature selection
- **Main View**: displays the selected feature

## Core Features

### 1. Chat

- Default chatbot screen
- LLM responses are streamed via **WebSocket**
- Displays:
  - `thinking`
  - `answer`
  - `retrieved` (RAG references)

### 2. Groups/ Folder upload

- Shows groups the user belongs to
- Displays:
  - Group members
  - Uploaded folders
- Allows adding members and folders

- Users can upload **local folders** from their PC
- Uploaded data is used for **RAG**
- RAG responses include **local file paths** of referenced files
- File upload and local file opening are handled via **Electron**

---

# Tech Stack

- Framework: React.js 19
- Build Tool: Vite 6
- Language: TypeScript 5.9.3
- Styling: Tailwind CSS 4.1.6

# Project Architecture

- see @rules/architecture.md for project architecture

# Commands

- `npm run dev`: Start the development server
- `npm run build`: Build for production

# Code Style

- see @rules/code-style.md for code style

# Do Not Section

- Do not commit directly to the branch.
