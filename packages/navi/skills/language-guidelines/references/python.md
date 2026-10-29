# Python Style Guide

> Source: Google Python Style Guide (https://google.github.io/styleguide/pyguide.html) and PEP 8 (https://peps.python.org/pep-0008/)

## Quick Rules

- Indent with 4 spaces, never tabs.
- Maximum line length is **80 characters** (Google standard).
- **Import rule**: Import packages and modules only, not individual functions or classes (e.g. `import os.path`, `from package import module`; exception: `from typing import ...`).
- **Docstrings**: Use Google docstring format with `Args:`, `Returns:`, and `Raises:` sections in triple double-quotes `"""`.
- Use `snake_case` for functions, variables, and modules; `CapWords` for classes; `UPPER_SNAKE_CASE` for constants.
- Never use mutable default arguments (e.g. `def foo(items=[])` is prohibited). Use `None` as default and assign inside function.
- Compare singletons using `is` / `is not`, never `==`.
- Type annotations: Annotate all public function arguments and return types. Use modern built-in generics (`list[str]`, `dict[str, int]`, `str | None`).
- Exception handling: Raise specific exceptions; never use bare `except:`. Chain with `raise ... from exc`.
- `TODO` format: `# TODO(username): description`.

## Formatting

- Indentation: 4 spaces per level.
- Line length: 80 characters maximum.
- Imports: Group imports at the top:
  1. Standard library imports
  2. Third-party library imports
  3. Local application / subpackage imports
  Each group separated by one blank line. Alphabetize imports within groups.
- Two blank lines between top-level functions and class definitions; one blank line between methods.
- Whitespace: No spaces immediately inside parentheses, brackets, or braces. One space around binary operators (`=`, `+`, `==`). No space before commas, colons, or semicolons.

## Naming

- Modules: Short `snake_case` (`math_utils.py`).
- Packages: Short, lowercase, no underscores (`emailclient`).
- Classes: `CapWords` (`OrderRepository`, `HttpClient`).
- Functions & Methods: `snake_case` (`calculate_tax`, `get_user_by_id`).
- Constants: `UPPER_SNAKE_CASE` at module level (`MAX_RETRIES`, `TIMEOUT_SECONDS`).
- Variables & Parameters: `snake_case` (`order_id`, `items`).
- Protected/Private attributes: Prefix with a single underscore (`_internal_cache`). Never use double leading underscores (avoid name mangling unless avoiding subclass collision).
- Exceptions: Suffix with `Error` (`ValidationError`).

## Comments & Documentation

- Docstrings must follow Google Python Docstring syntax:
  ```python
  def fetch_user_data(user_id: int, timeout_sec: float = 5.0) -> dict[str, str]:
      """Fetches profile data for a specific user from the upstream service.

      Args:
          user_id: The unique numeric ID of the user.
          timeout_sec: Maximum time in seconds to wait for network response.

      Returns:
          A dictionary mapping property names to user string attributes.

      Raises:
          UserNotFoundError: If no user with the given ID exists.
          TimeoutError: If the upstream service does not respond within timeout_sec.
      """
  ```
- Inline comments explain non-obvious *why*. Always use `# ` followed by a complete sentence.

## Anti-Patterns

- Wildcard imports: `from module import *`.
- Importing individual functions/classes instead of modules (e.g. `from foo.bar import MyClass` instead of `from foo import bar`).
- Mutable default arguments: `def process(data={}):`.
- Catching bare `Exception` without re-raising or logging: `except Exception: pass`.
- Overriding built-in names (`id`, `type`, `list`, `dir`).
- Deeply nested list comprehensions or lambda expressions.

## Code Example

```python
"""User authentication and profile management module."""

from typing import Final
import logging

_DEFAULT_TIMEOUT_SEC: Final[float] = 10.0


class AuthenticationError(Exception):
    """Raised when authentication credentials are invalid or expired."""


class UserManager:
    """Manages user state and credential verification."""

    def __init__(self, service_url: str) -> None:
        self._service_url = service_url
        self._cache: dict[str, str] = {}

    def authenticate(self, username: str, token: str) -> bool:
        """Verifies an authentication token for a user.

        Args:
            username: User account identifier.
            token: Cryptographic bearer token.

        Returns:
            True if credentials are valid, False otherwise.

        Raises:
            AuthenticationError: If the token format is corrupt.
        """
        if not token:
            raise AuthenticationError("Token cannot be empty")

        if username in self._cache:
            return self._cache[username] == token

        logging.info("Validating token for user %s", username)
        is_valid = token.startswith("valid_")
        if is_valid:
            self._cache[username] = token
        return is_valid
```

## Sources
- https://google.github.io/styleguide/pyguide.html
