#!/bin/sh

# Usage: sh git-generate-rebase.sh [--do] [base-branch] [directory-path]
# Example: sh git-generate-rebase.sh --do main .

DO_REBASE=0
if [ "$1" = "--do" ]; then
    DO_REBASE=1
    shift
fi

BASE=${1:-main}
DIR=${2:-.}
COMMIT_VERIFY_FLAG=${COMMIT_VERIFY_FLAG:---no-verify}

# 1. Navigate to directory safely
if [ -d "$DIR" ]; then
    cd "$DIR" || exit 1
else
    echo "❌ Directory '$DIR' does not exist."
    exit 1
fi

# Verify git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ '$DIR' is not a valid git repository."
    exit 1
fi

CURRENT=$(git rev-parse --abbrev-ref HEAD)

# Use %s with printf to avoid errors if strings contain dashes
printf "\n🔍 Analyzing branch '\033[1;36m%s\033[0m' against base '\033[1;36m%s\033[0m' in %s\n" "$CURRENT" "$BASE" "$DIR"
printf "   (Identifying ghost files and building rebase plan...)\n"
printf "   (Auto mode: drop ghost-only commits, split mixed commits, then rerun to drop ghost-split commits)\n"
printf "   (Commit verification flag: %s)\n" "$COMMIT_VERIFY_FLAG"
if [ "$DO_REBASE" -eq 1 ]; then
    printf "   (Execution mode: --do, will auto-start interactive rebase with generated todo)\n"
fi

# ---------------------------------------------------------
# PHASE 1: Identify Ghost Files
# ---------------------------------------------------------
# We use command substitution to capture the list without temp files.
# This loop runs in a subshell and echos valid ghosts to stdout, which GHOST_FILES captures.

GHOST_FILES=$(
    git log --name-only --pretty=format: --no-merges "$BASE..$CURRENT" | sort -u | grep -v '^$' | while IFS= read -r file; do
        is_ghost=0
        
        if [ -f "$file" ]; then
            # File exists: Check if it matches BASE exactly (Net Zero)
            if git diff --quiet "$BASE" "$CURRENT" -- "$file"; then
                is_ghost=1
            fi
        else
            # File is missing: Check if it exists in BASE
            # If missing in Branch AND missing in Base, it was Created then Deleted (Temp)
            if ! git show "$BASE:$file" > /dev/null 2>&1; then
                is_ghost=1
            fi
        fi

        if [ "$is_ghost" -eq 1 ]; then
            echo "$file"
        fi
    done
)

if [ -z "$GHOST_FILES" ]; then
    echo "✅ No ghost files found. Your branch is clean relative to $BASE!"
    exit 0
fi

# Count lines in GHOST_FILES (POSIX compatible way)
ghost_count=$(echo "$GHOST_FILES" | grep -c -v '^$')
printf "👻 Identified \033[1;33m%d\033[0m ghost files.\n" "$ghost_count"
printf "%s\n" "------------------------------------------------------------"

# Return success (0) only when full commit hash exists as a full line in list.
hash_in_list() {
    list=$1
    needle=$2
    echo "$list" | grep -Fxq "$needle"
}

# Commits whose patch already exists in BASE (git cherry marks with '-')
CHERRY_EQUIV_COMMITS=$(git cherry "$BASE" "$CURRENT" | awk '/^- / {print $2}')

# Commits that duplicate an earlier commit's patch within BASE..CURRENT
# (drop later duplicates to avoid empty cherry-pick stops)
DUPLICATE_PATCH_COMMITS=$(
    seen_patch_ids=""
    git log --reverse --no-merges --format="%H" "$BASE..$CURRENT" | while IFS= read -r full_hash; do
        patch_id=$(git show --pretty=format: "$full_hash" | git patch-id --stable 2>/dev/null | awk '{print $1}')
        if [ -z "$patch_id" ]; then
            continue
        fi

        if echo " $seen_patch_ids " | grep -Fq " $patch_id "; then
            echo "$full_hash"
        else
            seen_patch_ids="$seen_patch_ids $patch_id"
        fi
    done
)

# ---------------------------------------------------------
# PHASE 2: Generate Rebase Plan & Print Immediately
# ---------------------------------------------------------

printf "\n👇 COPY AND PASTE THE BLOCK BELOW INTO YOUR EDITOR 👇\n"
printf "   (Run: git rebase -i %s)\n" "$BASE"
printf "%s\n" "============================================================"

# Read commits Oldest -> Newest.
# We use a pipe | which is standard sh, instead of process substitution <()
# IFS='|' splits the hash and message.
PLAN_OUTPUT=$(git log --reverse --no-merges --format="%H|%h|%s" "$BASE..$CURRENT" | while IFS='|' read -r full_hash hash msg; do
    
    # Get files changed in this specific commit
    commit_files=$(git show --name-only --pretty=format: "$hash")
    
    files_ghost_all=""
    
    total_files_in_commit=0
    ghosts_in_commit=0
    
    # Process files in this commit.
    # We must use a 'here-string' workaround or just echo into a loop to be POSIX-ish
    # simpler to just iterate over the variable content with a loop
    for f in $commit_files; do
        if [ -z "$f" ]; then continue; fi
        total_files_in_commit=$((total_files_in_commit + 1))
        
        # Check if f is in GHOST_FILES
        # grep -F (fixed string) -x (whole line match) -q (quiet)
        if echo "$GHOST_FILES" | grep -Fxq "$f"; then
            ghosts_in_commit=$((ghosts_in_commit + 1))
            files_ghost_all="$files_ghost_all $f"
        fi
    done

    # --- OUTPUT LOGIC ---

    # Drop any split-out ghost commit created by an earlier run.
    if echo "$msg" | grep -q '^ghost-split:'; then
        echo "drop $hash $msg"
        continue
    fi
    
    if [ "$total_files_in_commit" -eq 0 ]; then
        # Empty commit (or merge artifact)
        echo "pick $hash $msg"

    elif hash_in_list "$CHERRY_EQUIV_COMMITS" "$full_hash"; then
        # Patch already exists on BASE; replay would be empty.
        echo "drop $hash $msg"

    elif hash_in_list "$DUPLICATE_PATCH_COMMITS" "$full_hash"; then
        # Later duplicate patch in this branch; replay would be empty once earlier commit is applied.
        echo "drop $hash $msg"
        
    elif [ "$ghosts_in_commit" -eq "$total_files_in_commit" ]; then
        # Pure ghost commit: safe to drop entirely.
        echo "drop $hash $msg"

    elif [ "$ghosts_in_commit" -gt 0 ]; then
        # Mixed commit: split ghost-file deltas into a dedicated follow-up commit.
        # The next run will auto-drop this ghost-split commit.
        echo "pick $hash $msg"

        clean_ghost_all=$(echo "$files_ghost_all" | xargs)
        echo "exec if git diff --name-only HEAD^ HEAD -- $clean_ghost_all | grep -q .; then git reset HEAD^ -- $clean_ghost_all && if git diff --quiet && git diff --cached --quiet; then true; else git commit $COMMIT_VERIFY_FLAG --amend --no-edit; fi && git add -A -- $clean_ghost_all && if git diff --cached --quiet; then true; else git commit $COMMIT_VERIFY_FLAG -m \"ghost-split: $hash\"; fi; else true; fi"
        
    else
        # Normal commit
        echo "pick $hash $msg"
    fi

done)

printf "%s\n" "$PLAN_OUTPUT"

printf "%s\n" "============================================================"

if echo "$PLAN_OUTPUT" | grep -q 'ghost-split:'; then
    printf "\n🔁 NOTE: This plan will create isolated ghost commits (ghost-split).\n"
    printf "   After this rebase completes, run this script again and rebase again to drop them.\n"
else
    printf "\n✅ NOTE: No ghost-split commits planned. One rebase pass should be enough.\n"
fi

if [ "$DO_REBASE" -eq 1 ]; then
    todo_dir="tmp"
    mkdir -p "$todo_dir"

    today=$(date +%Y%m%d)
    todo_file="$todo_dir/${today}-git-generate-rebase-todo.txt"

    printf "%s\n" "$PLAN_OUTPUT" > "$todo_file"

    printf "\n🚀 Starting rebase using generated todo file: %s\n" "$todo_file"
    printf "   (This rewrites history. Abort with: git rebase --abort)\n"

    GIT_SEQUENCE_EDITOR="cp $todo_file" git rebase -i "$BASE"
fi