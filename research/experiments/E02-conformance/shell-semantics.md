# E02-S05-T02 — measured shell semantics (C-E02-138..142)

Regenerate with `pnpm expr-shell-survey`. Host: `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`.

Locales available for the collation probes: `82 UTF-8 locale(s)`.

### test-true

A true conditional expression exits 0.

```bash
[ a = a ]
```

status: `0`  
output: ``

### test-false

A false conditional expression exits 1.

```bash
[ a = b ]
```

status: `1`  
output: ``

### test-error

An invalid operand is an *error*, not False: `[` exits 2, which is why the conformance harness asserts an exact status per row instead of "nonzero = False".

```bash
[ 1 -lt x ]
```

status: `2`  
output: `bash: line 1: [: x: integer expression expected`

### command-not-found

A missing helper exits 127 — the status a status-only harness would otherwise read as False.

```bash
azdo_expr_no_such_helper a b
```

status: `127`  
output: `bash: line 1: azdo_expr_no_such_helper: command not found`

### or-masks-error

An OR list runs its right operand after *any* non-zero status, so a status-2 conversion error in an earlier operand is masked as False (C-E02-143).

```bash
[ 1 -lt x ] 2>/dev/null || [ a = a ]; printf "final=%s" "$?"
```

status: `0`  
output: `final=0`

### and-short-circuits

An AND list does not run its right operand after a False left operand — the compiled `and` inherits the evaluator laziness of C-E02-028.

```bash
[ a = b ] && echo ran-right; printf "final=%s" "$?"
```

status: `0`  
output: `final=1`

### collate-c

Under LC_ALL=C, `[[ < ]]` compares by byte, so uppercase sorts before lowercase.

```bash
LC_ALL=C; export LC_ALL; [[ alpha < BETA ]] && printf true || printf false
```

status: `0`  
output: `false`

### collate-utf8

Under a UTF-8 locale the same comparison flips: `[[ < ]]` is locale-collated, so azdo_expr_cmp must pin LC_ALL=C to get the ordinal comparison Azure Pipelines documents (C-E02-142).

```bash
LC_ALL=en_US.UTF-8; export LC_ALL; [[ alpha < BETA ]] && printf true || printf false
```

status: `0`  
output: `true`

### upper-ascii

ASCII case folding is locale-independent.

```bash
LC_ALL=C; export LC_ALL; v=aBc; printf "%s" "${v^^}"
```

status: `0`  
output: `ABC`

### upper-non-ascii-c

Under LC_ALL=C, `^^` leaves non-ASCII alone, where .NET OrdinalIgnoreCase folds it — the declared non-ASCII divergence of C-E02-141.

```bash
LC_ALL=C; export LC_ALL; v=$(printf "\303\251"); printf "%s" "${v^^}"
```

status: `0`  
output: `é`

### command-substitution-newline

Command substitution deletes trailing newlines, so a variable whose value ends in a newline cannot round-trip through `$(azdo_var …)` (C-E02-140).

```bash
v=$(printf "a\n\n"); printf "[%s]" "$v"
```

status: `0`  
output: `[a]`

