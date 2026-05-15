# Jasper Information Architecture

## 1. Complete Information Architecture

```text
Jasper
├── Home
│   ├── Global Navigation
│   │   ├── Jasper
│   │   ├── Home
│   │   ├── Chat
│   │   ├── Jasper IQ
│   │   ├── Canvas
│   │   ├── Agents
│   │   └── Projects
│   │
│   ├── Primary Input
│   │   └── Ask Jasper anything
│   │
│   ├── Quick Actions
│   │   ├── Create Canvas
│   │   ├── Create Grid
│   │   └── Create Agent
│   │
│   ├── Recent Projects
│   │   ├── Project Card
│   │   │   ├── Project Title
│   │   │   ├── Last Modified Time
│   │   │   └── Project Type / Preview
│   │
│   └── Recent / Suggested Agents
│       ├── Agent Card
│       │   ├── Agent Name
│       │   ├── Agent Description
│       │   └── Open / Use Agent
│
├── Chat
│   ├── Chat Input
│   ├── Conversation Area
│   ├── Suggested Prompts
│   └── Model / Context Controls
│
├── Jasper IQ
│   ├── Brand Voice
│   │   ├── Create Brand Voice
│   │   ├── Saved Brand Voices
│   │   └── Brand Voice Details
│   │
│   ├── Audience
│   │   ├── Create Audience
│   │   ├── Saved Audiences
│   │   └── Audience Details
│   │
│   ├── Knowledge Base
│   │   ├── Add Knowledge
│   │   ├── Uploaded Sources
│   │   ├── Saved Knowledge Items
│   │   └── Knowledge Details
│   │
│   ├── Style Guide
│   │   ├── Writing Rules
│   │   ├── Terminology
│   │   ├── Do / Don’t Rules
│   │   └── Saved Style Guides
│   │
│   └── Visual Guide
│       ├── Visual Rules
│       ├── Brand Assets
│       ├── Image Guidelines
│       └── Saved Visual Guides
│
├── Canvas
│   ├── Top Bar
│   │   ├── Back / Home
│   │   ├── Canvas Title
│   │   ├── Project Settings
│   │   ├── Comments
│   │   ├── Share
│   │   └── User Account
│   │
│   ├── Left Panel
│   │   ├── Agent Selector / Current Agent
│   │   │   ├── Agent Name
│   │   │   ├── Agent Description
│   │   │   └── Change Agent
│   │   │
│   │   ├── Jasper IQ Settings
│   │   │   ├── Brand Voice
│   │   │   ├── Audience
│   │   │   ├── Language
│   │   │   ├── Web Search
│   │   │   └── Knowledge Search
│   │   │
│   │   ├── Agent Context
│   │   │   ├── Add Context
│   │   │   ├── Uploaded Context
│   │   │   └── Use Project Context
│   │   │
│   │   ├── Structured Input Fields
│   │   │   ├── Topic
│   │   │   ├── Length
│   │   │   ├── Outline
│   │   │   ├── Custom Instructions
│   │   │   └── Image Requirement
│   │   │
│   │   └── Generate Button
│   │
│   ├── Main Canvas Area
│   │   ├── Text Object
│   │   │   ├── Title
│   │   │   ├── Body Text
│   │   │   ├── Editable Content
│   │   │   └── Selection Toolbar
│   │   │
│   │   ├── Image Object
│   │   │   ├── Uploaded Image
│   │   │   ├── Image Preview
│   │   │   └── Image-Based Suggestions
│   │   │
│   │   ├── Generated Content Object
│   │   │   ├── Generated Text
│   │   │   ├── Draft Status
│   │   │   └── Editable Output
│   │   │
│   │   └── Freeform Layout
│   │       ├── Move Object
│   │       ├── Resize Object
│   │       └── Arrange Object
│   │
│   ├── Floating Text Action Menu
│   │   ├── Ask Agent
│   │   ├── Rewrite
│   │   ├── Polish
│   │   ├── Change Length
│   │   ├── Translate
│   │   ├── Format
│   │   └── Comment
│   │
│   ├── Add Content Menu
│   │   ├── Add Text
│   │   ├── Add Image
│   │   ├── Add Document
│   │   ├── Add Context
│   │   └── Add Generated Content
│   │
│   └── Bottom Toolbar
│       ├── Chat / Brainstorm
│       ├── Objects
│       ├── Search
│       ├── Add New
│       ├── Zoom Control
│       └── View / Grid Control
│
├── Agents
│   ├── Page Header
│   │   ├── Title
│   │   └── Description
│   │
│   ├── Agent Categories
│   │   ├── All Agents
│   │   ├── Workspace Agents
│   │   ├── My Agents
│   │   ├── Shared with Me
│   │   └── Favorites
│   │
│   ├── Agent Controls
│   │   ├── Search
│   │   ├── Sort
│   │   └── Filter
│   │
│   └── Agent Library
│       ├── Agent Card
│       │   ├── Icon
│       │   ├── Agent Name
│       │   ├── Agent Description
│       │   ├── Category
│       │   ├── Favorite
│       │   └── Use Agent
│       │
│       ├── Blog Outline Agent
│       ├── White Paper Outline Agent
│       ├── Instagram Caption Agent
│       ├── Keyword Agent
│       ├── Content Brief Agent
│       ├── Social Media Post Agent
│       ├── Product Description Agent
│       ├── Alt Text Generator Agent
│       └── FAQ Agent
│
└── Projects
    ├── Page Header
    │   ├── Title
    │   └── Create Project
    │
    ├── Project Categories
    │   ├── My Projects
    │   ├── Shared with Me
    │   └── All Projects
    │
    ├── Project Controls
    │   ├── Search
    │   ├── Sort
    │   └── Filter
    │
    └── Project List
        ├── Project Item
        │   ├── Project Name
        │   ├── Last Modified
        │   ├── Owner
        │   ├── Visibility
        │   └── More Actions
        │
        └── Project Detail
            ├── Project Title
            ├── Project Content
            ├── Project Context
            ├── Related Canvas
            ├── Related Agents
            ├── Sharing Settings
            └── Activity / Comments
```

## 2. Simplified Information Architecture

```text
Jasper
├── Home
│   ├── Ask Jasper anything
│   ├── Quick Create
│   ├── Recent Projects
│   └── Recent / Suggested Agents
│
├── Chat
│   ├── Conversation
│   └── Prompt Input
│
├── Jasper IQ
│   ├── Brand Voice
│   ├── Audience
│   ├── Knowledge Base
│   ├── Style Guide
│   └── Visual Guide
│
├── Canvas
│   ├── Structured Agent Panel
│   ├── Jasper IQ Settings
│   ├── Context Input
│   ├── Task Input Fields
│   ├── Main Editing Canvas
│   ├── Generated Content
│   ├── AI Editing Actions
│   └── Share / Comment
│
├── Agents
│   ├── Agent Categories
│   ├── Search / Sort / Filter
│   └── Agent Cards
│
└── Projects
    ├── Project Categories
    ├── Search / Sort / Filter
    ├── Project List
    └── Project Detail
```

## 3. Core Object Relationship

```text
User
└── Workspace
    ├── Projects
    │   └── Canvas
    │       ├── Text Objects
    │       ├── Image Objects
    │       ├── Generated Outputs
    │       └── Comments
    │
    ├── Agents
    │   └── Structured Input Forms
    │       ├── Task Fields
    │       ├── Context Fields
    │       └── Generation Settings
    │
    └── Jasper IQ
        ├── Brand Voice
        ├── Audience
        ├── Knowledge Base
        ├── Style Guide
        └── Visual Guide
```

## 4. Core Information Architecture Logic

```text
Workspace
→ Task Entry
→ Reusable Context
→ Structured Generation
→ Canvas Editing
→ Project Management
```

## 5. Main Sections and Roles

```text
Home = Main entry point
Chat = Free-form conversation entry
Agents = Task-template entry
Jasper IQ = Long-term context, including brand, audience, knowledge, and style
Canvas = Content generation and editing workspace
Projects = Content asset and collaboration management
```
