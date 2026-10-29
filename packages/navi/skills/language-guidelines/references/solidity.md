# Solidity Style Guide

> Source: Solidity Style Guide (https://docs.soliditylang.org/en/latest/style-guide.html) plus Solcurity Standard (https://github.com/transmissions11/solcurity)

## Quick Rules

- Indent with 4 spaces, never tabs. Maximum suggested line length is 120 characters.
- Start every file with an SPDX license identifier and a `pragma solidity` statement, then imports.
- Contracts, libraries, interfaces, structs, and events: `CapWords`. Functions, arguments, and state variables: `mixedCase`. Constants: `UPPER_CASE_WITH_UNDERSCORES`.
- Braces open on the same line as the declaration and close on their own line at the declaration's indentation.
- Two blank lines between top-level contracts; one blank line between functions inside a contract.
- Order contract elements: pragma, imports, events, errors, interfaces, libraries, contracts. Inside: types, state variables, events, errors, modifiers, functions.
- Order functions by visibility: constructor, receive, fallback, external, public, internal, private. Put `view` and `pure` last within each group.
- Use double quotes for strings. Use `require` for input validation, `revert` for state failures, and custom `error` types for documented failures.
- Fully annotate every public interface with NatSpec.

## Formatting

- Indent: 4 spaces per level. Spaces are preferred; mixing tabs and spaces is forbidden.
- Line length: 120 characters maximum suggested. When wrapping, the first argument goes on its own line, one indent is used, each argument is on its own line, and the closing `);` is on the final line by itself.
- Function body braces on the same line as the declaration for short functions; for long declarations, each modifier and each argument goes on its own line and the brace is on its own line.
- Modifier order in a function declaration: visibility, mutability, `virtual`, `override`, custom modifiers.
- `mapping` is not separated from its type by a space: `mapping(address => bool) registered;`. Array declarations have no space before the brackets: `uint[] values;`.
- No space inside parentheses or brackets, and none before a comma or semicolon. `receive()` and `fallback()` have no space before the parentheses.
- Imports are always at the top of the file, above any contract. UTF-8 or ASCII encoding.

## Naming

- Contracts, libraries, interfaces: `CapWords` - `SimpleToken`, `SmartBank`, `Owned`. The file name must match the contract name: `Congress.sol`.
- Structs: `CapWords` - `Position`, `MyCoin`. Enums: `CapWords` - `TokenGroup`. Events: `CapWords` - `Deposit`, `Transfer`.
- Functions: `mixedCase` - `getBalance`, `transfer`, `changeOwner`. Function arguments: `mixedCase` - `initialSupply`, `recipientAddress`.
- State and local variables: `mixedCase` - `totalSupply`, `isPreSale`. Modifiers: `mixedCase` - `onlyOwner`.
- Constants: `UPPER_CASE_WITH_UNDERSCORES` - `MAX_BLOCKS`, `TOKEN_NAME`, `CONTRACT_VERSION`.
- Non-external functions and state variables may use a leading underscore: `_internalHelper`. Never use `l`, `O`, or `I` as single-letter names.
- Library functions that operate on a struct take it as the first argument named `self`.
- Acronyms in `CapWords` are fully capitalized: `HTTPServerError`, not `HttpServerError`.

## Types and Data

- Use the smallest safe integer type: `uint256` for token amounts, `uint8` for flags, `int256` for signed arithmetic.
- Mark functions and variables `view` or `pure` whenever they do not modify state - this saves gas and is part of the public interface.
- Use `address payable` for recipients of value transfers; `address` cannot receive ether.
- Use custom `error` types instead of `string` revert reasons for documented failure modes.

## Comments and Documentation

- Use NatSpec (`///` or `/** */`) on every public function, event, and error, and on the contract itself.
- Standard tags: `@title`, `@author`, `@notice` (what it does), `@dev` (implementation detail), `@param`, `@return`, `@inheritdoc`.
- Annotate the full public interface (everything reachable through the ABI).
- Use `//` for implementation comments explaining *why*, not *what*.

## Error Handling

- Use `assert(condition)` only for internal invariants that should never be violated; it consumes all gas on failure.
- Define custom errors (`error Unauthorized();`) and `revert Unauthorized();` for documented failure modes - cheaper and more readable than a string.
- Reentrancy: apply the `nonReentrant` modifier on any function that transfers value before updating state.
- Use the checks-effects-interactions pattern: validate, then update state, then transfer.

## Testing

- Framework: Foundry is the community default for Solidity; Hardhat with ethers/mocha is also common.
- Layout: `test/` for test files, `script/` for deployment scripts, `src/` for contracts.
- Test file names match the contract: `test/Congress.t.sol`, with `contract CongressTest is Test`.
- Name test functions after the behavior: `function test_RevertWhen_NotOwner() public`.
- Use `vm.expectRevert()` to assert on failure, including the custom error where relevant.
- Use fuzz tests (`testFuzz_...`) with `bound()` for ranges, and invariant tests for cross-call consistency.
- Prefer a local deployment of dependencies over mocks when a real contract is available.
- Always test the failure paths; a contract with only happy-path tests is untested.

## Anti-Patterns

- A `string` revert reason where a custom error is possible. Instead: declare `error InsufficientBalance();`.
- `tx.origin` for authorization. Instead: use `msg.sender`.
- Missing `nonReentrant` on a function that sends ether. Instead: guard with the modifier.
- A `payable` function that accepts more than it needs. Instead: pull payments explicitly.
- Unchecked low-level `call` return value. Instead: check the `success` boolean.
- `uint` for token amounts. Instead: use `uint256` with explicit decimals handling.
- A `function` that reads and writes state but is not marked `view`/`pure` when it could be.
- `assembly` blocks without a comment explaining the memory safety reasoning.

## Code Example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Owned} from "./Owned.sol";

/// @title A minimal token with a capped supply
/// @notice Tracks balances and rejects transfers above the cap.
contract Token is Owned {
    /// @notice Emitted when a transfer moves tokens between accounts.
    event Transfer(address indexed from, address indexed to, uint256 amount);

    /// @notice Raised when an account does not hold enough tokens.
    error InsufficientBalance(address account, uint256 amount);

    /// @notice Maximum number of tokens that may ever exist.
    uint256 public constant MAX_SUPPLY = 1_000_000 ether;

    /// @notice Token balance of each account.
    mapping(address => uint256) public balanceOf;
    /// @notice Sends `amount` tokens to `recipient`.
    /// @param recipient The account receiving the tokens.
    /// @param amount The number of tokens to transfer.
    function transfer(address recipient, uint256 amount) external returns (bool) {
        uint256 senderBalance = balanceOf[msg.sender];
        if (senderBalance < amount) {
            revert InsufficientBalance(msg.sender, amount);
        }
        unchecked {
            balanceOf[msg.sender] = senderBalance - amount;
            balanceOf[recipient] += amount;
        }
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }
}
```

## Sources

- https://docs.soliditylang.org/en/latest/style-guide.html
- https://github.com/ethereum/solidity/blob/develop/docs/style-guide.rst
- https://github.com/transmissions11/solcurity
