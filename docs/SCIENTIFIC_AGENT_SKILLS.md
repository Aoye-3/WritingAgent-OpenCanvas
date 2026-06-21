# Scientific Agent Skills Integration

FacetWrite imports a curated universal subset of `K-Dense-AI/scientific-agent-skills` as project Skills. The goal is to strengthen OpenCanvas research workflows without flooding the Skill catalog with standalone domain-specific biology, chemistry, medicine, or materials packages before the node interaction model is validated.

## First-Round Scope

Imported Skills live under `skills/public`:

| Folder | Skills | Purpose |
| --- | --- | --- |
| `science-db` | `database-lookup`, `paper-lookup` | Auditable lookup and paper/source reference workflows. |
| `analysis-viz` | `exploratory-data-analysis`, `matplotlib` | General EDA and charting guidance, aligned with existing `data-analysis` and `chart-visualization`. |
| `writing-review` | `literature-review`, `peer-review`, `citation-management` | Literature synthesis, structured critique, and citation handling. |
| `diagram-assets` | `markdown-mermaid-writing`, `infographics`, `generate-image` | Editable diagrams and visual communication; Mermaid/Canvas diagram delivery is preferred before binary image generation. |
| `document-ingestion` | `markitdown`, `pdf`, `docx` | Convert and process source documents for Knowledge and Canvas use. |

`database-lookup` is imported with its complete upstream `references/` directory. That keeps the first round small at the Skill level while still letting a single auditable database lookup Skill route to documented public endpoints such as PubChem, ChEMBL, FDA, NASA, FRED, SEC EDGAR, WHO, and related references. Future domain packs can still add specialized standalone Skills behind explicit review.

## Import And Provenance

The import manifest is `skills/public/scientific-agent-skills.import.json`. Each imported Skill has a `facetwrite.skill.json` sidecar containing:

- upstream repository, path, commit, and URL;
- license and required environment variable names;
- original upstream tool names;
- mapped Agent Runtime sandbox tools;
- execution mode and risk level.

Refresh the curated subset with:

```powershell
node scripts/import-scientific-agent-skills.mjs
```

The script writes only under `F:\.FinalProject\skills\public`, normalizes upstream `SKILL.md` frontmatter, and preserves upstream `references/`, `scripts/`, and `templates/` files for sandbox use.

## Runtime Policy

Imported executable Skills use `executionMode:"sandbox"`. FacetWrite does not run their scripts directly from the Express backend. Upstream tool names such as `Read`, `Write`, `Edit`, `Bash`, and `WebFetch` are recorded as `originalAllowedTools` and mapped to sandbox tool names such as `read_file`, `write_file`, `str_replace`, `bash`, and `web_fetch`.

Canvas and Knowledge remain FacetWrite-owned:

- lookup outputs should become `reference` nodes with endpoint, parameters, access date, and count/pagination notes;
- EDA and visualization outputs should become editable `document` nodes plus references and optional diagram nodes;
- literature reviews should keep search strategy, inclusion/exclusion criteria, and citations as auditable Canvas artifacts;
- Mermaid and infographics should prefer editable diagram delivery over binary image-only output.
