# Perl Style Guide

> Source: perlstyle, the Perl style guide shipped with the Perl core (https://perldoc.perl.org/perlstyle), supplemented by "Perl Elements to Avoid" (http://perl-begin.org/tutorials/bad-elements/) from the awesome list. perlstyle is written in Larry Wall's voice and marks some preferences as strong and others as weak; the strong ones are treated as rules below.

## Quick Rules
- Always `use strict;` and `use warnings;`. In modern Perl, `use v5.36;` enables both plus several named features.
- Indent with 4 columns.
- Put the opening curly of a multi-line block on the same line as the keyword that started the construct; the closing curly lines up with that keyword.
- Do not cuddle the `else`: put `else` on its own line after the closing brace.
- No space between a function name and its opening parenthesis; spaces after each comma; no space before the semicolon.
- Declare variables with `my` (or `our`/`state` as appropriate), never with bare `local` unless you need dynamic scoping.
- Use lower-case with underscores for multi-word variable and function names: `$var_names_like_this`, `sub as_string`.
- Use `$ALL_CAPS` for constants and `$Some_Caps_Here` for package-wide globals. Function and method names are all lower case.
- Modules are named `Module::Name` with an uppercase first letter and no underscores.
- Always check the return code of system calls; `die` with a message that names the program, the call, and includes `$!`. Use `and`/`or` instead of `&&`/`||` when you do not need extra parentheses. Document with POD: `C<>` for code, `B<>` for command names, `F<>` for file names.

## Formatting
- Indentation: 4 columns (perlstyle calls this a weak preference but it is the convention).
- Opening curly on the same line as the keyword: `if ($x) {`; closing curly aligned with the keyword. Uncuddled `else`: the `else` goes on its own line, never `} else {`.
- One statement per line. A one-line block may include its own braces, and the semicolon may be omitted there. Space around binary operators; space after a comma; no space before a semicolon.
- No space between a subroutine name and its parentheses: `print $fh "text";` and `my @sorted = sort { $a cmp $b } @items;`. Long lines are broken after an operator (except `and` and `or`). Line up corresponding items vertically when a line would be too long anyway.
- Blank lines between chunks that do different things. No tabs; no trailing whitespace.
- Use `and`/`or` in place of `&&`/`||` to avoid heavy parenthesisation around list operators, and use here-documents (`<<"END"`) instead of a series of `print` statements.

## Naming
- Variables: `lower_case_with_underscores` for locals (`$var_names_like_this`). Capitalisation can signal scope:
- `$ALL_CAPS_HERE` - constants only.
- `$Some_Caps_Here` - package-wide globals.
- `$no_caps_here` - `my` or `local` variables with function scope.
- Short identifiers like `$gotit` are acceptable, but prefer mnemonic names.
- Subroutines and methods: all lower case, snake case - `sub as_string`, `$obj->as_string`.
- Packages and modules: `Module::Name` - the first letter is uppercase, words are separated by `::`, no underscores. Lowercase module names are reserved for pragma modules such as `strict`.
- Constants: `use constant` with an UPPERCASE name. Private functions and variables that must not be used outside their package get a leading underscore: `sub _internal_helper`.
- File handles: lowercase, often with a leading underscore when lexical - `open(my $fh, '<', $file)`. Use `CamelCase` for a hash key only when it is part of an external contract.

## Types and Data
- Perl is untyped by default; use the data structure that best fits the problem. Do not force a scalar where a list is meant, and do not use a string where a numeric comparison is meant.
- `undef` is the absence of a value. A hash key whose value is `undef` still exists, so check with `exists $hash->{$key}` rather than `defined`.
- Scalars, arrays, and hashes are distinct types; `wantarray` in a sub tells you which context you were called in. Returning a list from a scalar context silently flattens. Copy on assignment (`my @copy = @original;`) because assignment aliases references, not values.
- Use `local` only where you deliberately want dynamic scoping, and always restore it. Prefer `state` over `my` for closures that must keep state between calls.
- Use hashes for lookups, not nested `if`/`elsif` chains over arrays. Sanitise untrusted input before it reaches a SQL string, a shell command, or an `eval`.

## Comments and Documentation
- Use POD for public documentation. Write it in a consistent format across the distribution.
- POD codes: `C<>` for function, variable, and module names (function names include the parentheses, e.g. `C<as_string()>`), `B<>` for command names such as `cat` or `grep`, `F<>` or `C<>` for file names.
- Put the name of the module or distribution in a `=head1 NAME` section followed by a one-line abstract. Use `=head1`, `=head2`, `=over`, `=item`, `=back`, `=cut` consistently.
- Implementation comments use `#` on their own line above the code. Do not leave commented-out code in a file. Comments explain why, not what. TODO format: `# TODO(owner): description`.
- `__END__` or `__DATA__` marks the end of the code section; anything after it is data, not code.

## Error Handling
- `die` with a message for an unrecoverable condition. Include the failing program name, the operation, and the underlying error: `die "Can't open $file: $!\n";`. Finish `die` messages with a newline so the message is not appended to Perl's `at line N` suffix.
- `warn` for a non-fatal problem: `warn "Retrying...\n";`.
- Check every system call: `open(my $fh, '<', $file) or die "...";`.
- Use `eval { ... }; if (my $err = $@) { ... }` to trap an exception. Always clear `$@` after checking it, and never use a string `eval` with interpolated data (that is a code injection risk).
- Do not use exceptions for ordinary control flow; return a status or an empty list instead. `local $@` before an `eval` when the surrounding code relies on `$@`; `local $SIG{__WARN__}` to trap warnings.
- Prefer `croak` from `Carp` inside modules so the error is reported at the caller's location rather than inside the module. Never swallow an error with a bare `eval { ... };` and no check of `$@`.

## Testing
- Frameworks: `Test::More` is the core standard; `Test::Simple` adds `Test::Deep`, `Test::Exception`, and `Test::MockObject`; `Test2::V0` is the modern successor.
- Layout: a `t/` directory with one test file per module, named `t/<module>.t` (e.g. `t/config.t`).
- Test scripts start with `use Test::More;` or `use Test2::V0;` and end with `done_testing();`.
- Test names are strings describing the behaviour: `is($config->{name}, 'svc', 'name defaults to svc');`.
- Prefer `is`, `is_deeply`, `like`, `ok`, `cmp_ok` over raw `die`/`print` assertions, and `done_testing()` rather than a fixed plan count. Tests should not depend on execution order or on shared global state; set up fresh fixtures per test.
- `Test::Exception` is the right tool for checking that code dies: `like(exception { ... }, qr/.../, 'dies when the file is missing');`.
- Cover the failure paths, not just the happy path; the `t/` directory is where regressions are caught.

## Anti-Patterns
- `local $x` used as a substitute for `my` - instead use `my` for lexical scope and reserve `local` for deliberate dynamic scoping.
- `$var = $var || "default"` when the value can legitimately be `0` or `""` - instead use `//` (defined-or) or `exists`.
- `if ($x == "1")` - instead use `eq` for strings and `==` for numbers; never compare a number with `eq`.
- `system("rm -f $file")` with interpolated data - instead use the list form `system('rm', '-f', $file)` and validate the input.
- `eval "$user_code"` - instead use a hash dispatch table of allowed operations.
- `$hash{key}` without quoting - instead `$hash{'key'}`; the bareword form is deprecated and warns.
- `unless (defined $x) { ... } else { ... }` - instead use `if (!defined $x) { ... } else { ... }`.
- Backticks for command output when a list-form call is clearer - instead use `qx` with an explicit list, or `open` with a pipe.

## Code Example
```perl
use strict;
use warnings;

package Config;

use Carp qw(croak);

sub parse_config {
    my ($text) = @_;

    croak 'parse_config requires a document' unless defined $text;

    my %values = (name => 'unnamed-service', retries => 3);

    for my $line ( split /\n/, $text ) {
        next if $line =~ /^\s*(?:#|$)/;

        my ( $key, $value ) = $line =~ /^\s*([^=]+?)\s*=\s*(.*?)\s*$/;
        croak "malformed configuration line: $line" unless defined $key;

        $values{$key} = $value;
    }

    return \%values;
}

1;

__END__

=head1 NAME

Config - parse a key=value configuration document

=head1 DESCRIPTION

C<parse_config()> reads a document of C<key=value> lines and returns a hash
reference. Croaks when a line is malformed.

=cut
```

## Sources
- https://perldoc.perl.org/perlstyle
- https://perldoc.perl.org/perlvar
- http://perl-begin.org/tutorials/bad-elements/
- https://metacpan.org/pod/Test::More
