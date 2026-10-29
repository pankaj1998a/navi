# Fortran Style Guide

> Source: Fortran Style Guide (https://fortran-lang.org/learn/best_practices/style_guide/), the style-guide chapter of Fortran Best Practices (https://fortran-lang.org/learn/best_practices/). The URL listed in the awesome list (`https://fortran-lang.org/en/learn/best_practices/`) returns 404; the guide now lives at the two URLs above. Rules not covered there are ISO Fortran community consensus (fpm layout, `iso_fortran_env`, `error stop`) and are labelled as such.

## Quick Rules
- Write every Fortran keyword in lowercase: `do`, `end do`, `subroutine`, `module`, `implicit none`.
- Start every program unit with `implicit none`. Never rely on implicit typing or implicit `external`.
- Put shared code in a `module`; keep `subroutine`/`function` bodies free of global state.
- Use 2 to 4 spaces of indentation, consistently within a project. Never mix tabs and spaces.
- Keep names short and lowercase; use underscores to separate words in multi-word names (`spline_interp`, `stop_error`), not CamelCase.
- Give every dummy argument an explicit `intent(in)`, `intent(out)`, or `intent(inout)`.
- Handle I/O errors explicitly: check `iostat`/`iomsg`, or use `error stop` with a message.
- Prefer `iso_fortran_env` (`error_unit`, `output_unit`, `real64`) over hard-coded unit numbers or `real(kind=8)`.
- Comment with `!`; use `!>` for doc comments on module procedures so documentation tooling can pick them up.
- Do not rely on implicit array bounds; use `allocatable` with explicit allocation, or assumed-shape dummy arguments.

## Formatting
- Indentation: 2, 3, or 4 spaces (the guide calls these the common choices). Pick one per project; never use tabs.
- No hard line-length limit in the guide; keep lines under 100 characters and wrap at a natural boundary with `&`.
- Name long constructs: `name : do i = 1, n` and `end do name`.
- One statement per line; do not separate statements with `;`.
- Write `end do`, `end if`, `end select case`, `end subroutine`, `end module` in full; never abbreviate to `enddo` / `endif`.
- Order the parts of a unit: `use` statements, `implicit none`, visibility, `type` definitions, `parameter`, saved variables, then procedures.
- No trailing whitespace; files end with a newline. Put compiler flags in the build system, not in the source.

## Naming
- Files: lowercase with underscores, `.f90` for free-form source. `fpm` expects `src/<module>.f90` and `test/test_<name>.f90`.
- Modules: lowercase, short, no underscores unless needed, matching the file name: `module statistics` in `src/statistics.f90`.
- Subroutines and functions: lowercase, verb-ish. A procedure that changes its arguments is a verb (`compute_energies`); a function reads like a noun (`spline_interp`).
- Dummy arguments: lowercase with underscores (`num_steps`, `x_values`), named for the quantity, not the type. Loop indices are `i`, `j`, `k`, outermost first.
- Module variables: lowercase; make the module `private` by default and export explicitly with `public ::`.
- Parameters: lowercase with underscores (`gravity = 9.80665_real64`).
- Derived types: short and lowercase; members lowercase with underscores (`num_nodes`). No leading or trailing underscores in identifiers.

## Types and Data
- Declare every derived type in a module and give it an explicit `private`/`public` rule.
- Use `intent(in)` on all read-only dummy arguments; `intent(out)` only when the procedure is the sole writer.
- Prefer `allocatable` arrays over automatic arrays when the size is not a small compile-time constant.
- Prefer assumed-shape dummy arguments (`real(real64), intent(in) :: values(:)`) so routines accept any size.
- Prefer `select case` over chains of `if ... then else if` for multi-way dispatch, and `elemental` procedures for component-wise operations.
- Be explicit about `real32` versus `real64` instead of relying on the default kind.
- Prefer static type extension (`type, extends(parent)`) with overridden bound procedures for inheritance; use runtime `select type` dispatch (`type is`/`class is`) sparingly, and avoid `save` and module-level mutable state.

## Comments and Documentation
- Comments start with `!`. Use `!>` for doc comments on module procedures and `!!` for module-level documentation.
- Comments explain *why*, not *what*. Do not narrate obvious assignments.
- Put a comment on its own line above the code, or after two spaces at the end of a short line. Never mix the two in one block.
- Use `! TODO(owner): description` for deferred work so it can be grepped.
- Delete commented-out code; rely on version control. Keep comment lines under 80 characters.

## Error Handling
- Do not ignore I/O errors. Either use the `iostat=`/`iomsg=` optional arguments on each I/O statement, or switch off the default abort with `error stop`.
- `error stop` ends the program with a nonzero exit status and a message. Use it for unrecoverable conditions, not for ordinary control flow.
- For recoverable conditions, return a status: `subroutine load(path, ok, message)` with `intent(out) :: ok, message`.
- Use `assert` from `iso_fortran_env` for internal invariants, or `error stop` naming the routine: `error stop "load: could not open file"`. Do not print errors to `*`; write to `error_unit`.

## Testing
- Layout: a `test/` directory with one file per module, named `test_<module>.f90`, plus a `test/runtests.f90` driver.
- Framework: [test-drive](https://github.com/fortran-lang/test-drive) is the community default; pFUnit is the older alternative. Use whichever the project already uses.
- Test names: `test_<routine>_<behaviour>`, e.g. `test_mean_of_empty_array_is_zero`. One `test_drive` / `check` block per behaviour, each asserting a single fact.
- Cover the edges: empty inputs, single-element inputs, boundary values, and error paths that must be reported. Prefer pure functions in the library so tests need no I/O setup.

## Anti-Patterns
- Implicit typing (`integer i` without `implicit none`) - instead declare `integer :: i` and add `implicit none` to every unit.
- `COMMON` blocks for sharing state - instead put the variables in a module and control access with `private`/`public`.
- Hard-coded unit numbers (`write(6, ...)`) - instead `use iso_fortran_env, only: output_unit`.
- One giant `program` with everything inline - instead split into modules and small procedures.
- `if (flag == .true.)` - instead write `if (flag)`; and `if (x /= 0)` rather than `if (x == 0) then ... else ...`.
- Assuming array bounds are known inside a procedure - instead use assumed-shape `(:)` and query `size()`.
- Modifying a `do` loop counter inside the body - instead use a local copy; the counter is only defined during the iteration.
- `goto` labels to escape nested loops - instead restructure with a `found` logical flag or named constructs.

## Code Example
```fortran
module statistics
  use, intrinsic :: iso_fortran_env, only: error_unit
  implicit none
  private
  public :: mean, load_samples

contains

  !> Compute the arithmetic mean; returns 0.0 for an empty input.
  pure function mean(values) result(avg)
    real(real64), intent(in) :: values(:)
    real(real64) :: avg

    if (size(values) == 0) then
      avg = 0.0_real64
    else
      avg = sum(values) / real(size(values), real64)
    end if
  end function mean

  !> Load samples from a file, reporting failures to the caller.
  subroutine load_samples(path, samples, ok, message)
    character(len=*), intent(in) :: path
    real(real64), allocatable, intent(out) :: samples(:)
    logical, intent(out) :: ok
    character(len=*), intent(out) :: message
    integer :: unit, ios

    open(newunit=unit, file=path, status='old', action='read', iostat=ios)
    if (ios /= 0) then
      ok = .false.
      write(message, '(a,a)') 'cannot open ', path
      return
    end if
    allocate(samples(0))
    read(unit, *, iostat=ios) samples
    close(unit)
    ok = (ios == 0)
  end subroutine load_samples

end module statistics
```

## Sources
- https://fortran-lang.org/learn/best_practices/style_guide/
- https://fortran-lang.org/learn/best_practices/
- https://fortran-lang.org/learn/best_practices/modules_programs/
- https://fortran-lang.org/learn/best_practices/file_io/
- https://fortran-lang.org/learn/best_practices/floating_point/
- https://github.com/fortran-lang/test-drive
