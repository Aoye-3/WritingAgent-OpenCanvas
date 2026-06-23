from typing import Literal

from langchain.tools import tool
from pydantic import BaseModel, Field, model_validator


class ClarificationOption(BaseModel):
    id: str = Field(description="Stable option id, for example recent_review.")
    label: str = Field(description="Short user-facing option label.")
    detail: str | None = Field(default=None, description="Short explanation of what this option means.")
    description: str | None = Field(default=None, description="Short explanation of what this option means.")
    recommended: bool = Field(default=False, description="Whether this option is recommended. At most one option can be recommended.")

    @model_validator(mode="after")
    def require_detail_or_description(self):
        if not (self.detail and self.detail.strip()) and not (self.description and self.description.strip()):
            raise ValueError("Clarification options require detail or description")
        return self


class AskClarificationArgs(BaseModel):
    question: str = Field(description="The specific clarification question to ask the user.")
    clarification_type: Literal[
        "missing_info",
        "ambiguous_requirement",
        "approach_choice",
        "risk_confirmation",
        "suggestion",
    ] = Field(description="The type of clarification needed.")
    context: str | None = Field(default=None, description="Optional context explaining why clarification is needed.")
    options: list[ClarificationOption] = Field(
        min_length=2,
        max_length=3,
        description="Two or three mutually exclusive choices for the user.",
    )

    @model_validator(mode="after")
    def require_single_recommended_option(self):
        if sum(1 for option in self.options if option.recommended) > 1:
            raise ValueError("At most one clarification option can be recommended")
        return self


@tool(
    "ask_clarification",
    args_schema=AskClarificationArgs,
    description="Ask the user one structured clarification with a question and two or three choices.",
    return_direct=True,
)
def ask_clarification_tool(
    question: str,
    clarification_type: Literal[
        "missing_info",
        "ambiguous_requirement",
        "approach_choice",
        "risk_confirmation",
        "suggestion",
    ],
    context: str | None = None,
    options: list[ClarificationOption] | None = None,
) -> str:
    """Ask the user for clarification when you need more information to proceed.

    Use this tool when you encounter situations where you cannot proceed without user input:

    - **Missing information**: Required details not provided (e.g., file paths, URLs, specific requirements)
    - **Ambiguous requirements**: Multiple valid interpretations exist
    - **Approach choices**: Several valid approaches exist and you need user preference
    - **Risky operations**: Destructive actions that need explicit confirmation (e.g., deleting files, modifying production)
    - **Suggestions**: You have a recommendation but want user approval before proceeding

    The execution will be interrupted and the question will be presented to the user.
    Wait for the user's response before continuing.

    When to use ask_clarification:
    - You need information that wasn't provided in the user's request
    - The requirement can be interpreted in multiple ways
    - Multiple valid implementation approaches exist
    - You're about to perform a potentially dangerous operation
    - You have a recommendation but need user approval

    Best practices:
    - Ask ONE clarification at a time for clarity
    - Be specific and clear in your question
    - Don't make assumptions when clarification is needed
    - For risky operations, ALWAYS ask for confirmation
    - After calling this tool, execution will be interrupted automatically

    Args:
        question: The clarification question to ask the user. Be specific and clear.
        clarification_type: The type of clarification needed (missing_info, ambiguous_requirement, approach_choice, risk_confirmation, suggestion).
        context: Optional context explaining why clarification is needed. Helps the user understand the situation.
        options: Required list of 2-3 choices. Each option must include id, label, and detail or description. At most one option may be recommended.
    """
    # This is a placeholder implementation
    # The actual logic is handled by ClarificationMiddleware which intercepts this tool call
    # and interrupts execution to present the question to the user
    return "Clarification request processed by middleware"
