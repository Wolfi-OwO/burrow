# ADR-0007: The sorter learns from what the person files by hand, as examples beside the zero-shot score

## Status

Accepted (2026-11-22). Extends [ADR-0004](0004-vision-model.md); the zero-shot scoring it describes is unchanged and
is still what a new account sorts with.

## Context

The sorter scores a picture against the folder names with a small CLIP model that only reads English. A folder called
"Matura feier" is read as noise, so adult furry artwork was filed there; the person moved those pictures by hand, and
the next ones went to the same wrong folder again. A correction changed one file and taught the sorter nothing.

## Decision

**Every file the person files, moves or takes from review is remembered as an example** (`sorting_examples`: the file,
the folder). A move to Unsorted forgets it; a later move replaces it. Moves the system makes on its own (the rating
check) are not examples, because they say nothing about what the person wants.

**A new picture is compared with its nearest examples** (pgvector, the embedding is already stored for every picture).
At each level of the tree the examples vote for the candidate that holds their folder, an example filed deeper counting
for the branch above it. A folder's score is then

`(1 - trust) * zero-shot + trust * share`, with `trust = maxTrust * min(1, total weight / fullWeight)`

and an example's weight rising from 0 at a similarity floor (0.75) to 1 for the same picture. With no examples nearby
`trust` is 0 and nothing changes. With about three close ones the examples count for most (never all: `maxTrust` is
0.85), so the picture still speaks, and one distant example cannot overrule a clear zero-shot answer.

**The examples are kept apart from `files.category_id`**, because "Unsort everything" and "Re-sort this folder" clear
where files sit and must not make the sorter forget what it was taught. Deleting a folder or a file deletes its
examples.

## Consequences

- The constants (`LEARN_MIN_SIMILARITY`, `LEARN_FULL_WEIGHT`, `LEARN_MAX_TRUST`, `LEARN_NEIGHBOURS`) were chosen from
  the shape of the problem, not measured on a real library: unit tests pin the behaviour, but the values are the first
  thing to adjust if the sorter is too stubborn or too eager.
- Files filed before this change are not examples; the sorter learns from the first correction onwards.
- A picture is only as good as the examples: a mistaken move teaches a mistake until the file is moved again.
- A folder name the model cannot read still scores badly on its own; a hint through the assistant ("Matura feier is a
  graduation party") helps the zero-shot half, and examples help the rest.
