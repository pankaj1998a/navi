# Objective-C Style Guide

> Source: Objective-C Style Guide (https://github.com/github/objective-c-style-guide) - the repository is archived, so it is cited as the community guide it was. It builds on Apple's Coding Guidelines for Cocoa (https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/CodingGuidelines/). The Google Objective-C Style Guide (https://github.com/google/styleguide/blob/gh-pages/objcguide.md) was also consulted for naming and formatting details.

## Quick Rules
- Indent with tabs, not spaces. The Apple convention for Objective-C is a tab per level.
- End every file with a newline and never leave trailing whitespace. Hard-wrap comments at 80 characters.
- Document every method declaration in Tomdoc style.
- Use `#pragma mark` to group methods by functionality and to separate protocol implementations.
- Prefix instance variables with an underscore; the compiler synthesises them this way. Do not use `@synthesize` unless required.
- Prefer `instancetype` over `id` in constructors and factory methods, and use dot syntax for idempotent access, including properties and class methods.
- Return and break early; do not nest deeply. Never use exceptions for flow control. Use `NSError **` for recoverable errors.
- Properties: `copy` for immutable objects, `strong` only for mutable objects, `readonly` when set once in `-init`.
- No space between an object type and the protocol it conforms to: `id<NSCopying>`.
- Name categories for the functionality they add and always prefix their methods.

## Formatting
- Indentation: tabs. Tabs are the Apple/Objective-C convention; do not mix tabs and spaces.
- Braces: opening brace on the same line as the statement, closing brace on a new line.
- Put a single space after keywords and before their parentheses: `if (condition) {`. No spaces between parentheses and their contents.
- Separate binary operands with one space; unary operands and casts get none: `NewType a = (NewType)b;`.
- Method declarations stay on one line; do not break a selector across lines.
- Blank line between logical chunks of a file; use `#pragma mark` to delimit the groups. No space before a semicolon; a space after each comma.
- Long or complex literals (arrays, dictionaries) may be split over multiple lines with a trailing comma. Files end with a newline.

## Naming
- Classes: `UpperCamelCase` with a prefix that groups related classes - `GHWebView`, `GHBorderedView`. Pick a two- or three-letter prefix and apply it consistently.
- Class methods (factories): a `+` method named after the class - `+ (instancetype)webViewWithFrame:`. Instance methods: a `-` method, verb-first and lowerCamelCase - `- (void)reloadData`.
- Delegate methods: start with the base name of the delegate's owner, e.g. `webView:didFinishLoad:`. Properties: lowerCamelCase noun - `title`, `contentURL`. Booleans read as predicates: `isValid`, `hasContent`.
- Instance variables: underscore prefix - `_title`. Declare an ivar only when the property's type differs from the backing type.
- Enum cases: `k` prefix followed by `UpperCamelCase` - `GHButtonStylePrimary`. Constants: `k` prefix plus `UpperCamelCase` for file-scope constants.
- C functions: prefixed with the class or framework name, no space before the parenthesis - `void GHAwesomeFunction(BOOL hasSomeArgs);`. Categories: `ClassName+CategoryName`; category methods carry the class prefix. Private helpers go in a class extension named `ClassName+Private`.

## Types and Data
- Use `nil` for absent object references; `NULL` for C pointers; `NSNotFound` for failed index lookups.
- Prefer `instancetype` in initialisers and factories over `id` or a concrete type. Use lightweight generics (`NSArray<NSString *> *`) to express element types.
- Use `NSInteger` / `NSUInteger` for integers, `CGFloat` for UI geometry, `BOOL` for flags, `NSString` for text. Use `nullable` / `_Nullable` annotations in headers for pointers that may be `nil`, and document whether a parameter accepts `nil`.
- Prefer immutable types for public properties; expose mutability only when it is part of the contract. Use `NSCopying` for value types that will be stored in collections or shared.
- Declare memory-management semantics on every property, including `readonly` ones. Avoid `weak` for long-lived references; a weak reference that outlives its owner is a design smell.

## Comments and Documentation
- All method declarations should be documented, using Tomdoc (http://tomdoc.org/) style: a `///` summary line, then `@param` and `@returns` lines. Comments are hard-wrapped at 80 characters and explain why, not what.
- Use `#pragma mark` to categorise methods into logical groups (properties, lifecycle, drawing, protocol conformances).
- TODO format: `// TODO(owner): description`. Do not leave commented-out code; rely on version control.

## Error Handling
- Do not use exceptions for flow control. Use exceptions only to signal programmer error.
- For recoverable errors, take an `NSError **` out-parameter and return `BOOL` or `nil`, populated with a localised description and a stable error code from a declared `NSError` domain. Check the result at the call site; an `NSError **` parameter is not optional.
- When a method fails, return `nil` or `NO` and set the error, and do not partially mutate the receiver.
- `NSAssert` / `NSParameterAssert` are for programmer error and are stripped in release builds; do not use them to validate user input.
- Never swallow an error silently; if you catch an exception to translate it, rethrow as `NSError` with the original as the underlying error.

## Testing
- Frameworks: XCTest is the standard; the older SenTestingKit / OCHamcrest are deprecated.
- Layout: a separate test target with one test class per class under test - `GHWebViewTests.m`. Test class inherits from `XCTestCase`; test methods are `- (void)testExample` and are alphabetically ordered by name.
- Use `setUp` and `tearDown` for fixture setup and teardown; call `[super setUp]` and `[super tearDown]`. Use `XCTAssertTrue`, `XCTAssertEqual`, `XCTAssertEqualObjects`, `XCTAssertNil`, and `XCTAssertNoThrow` rather than raw `NSAssert`.
- Test through the public API of the class; do not poke at private ivars. Use a helper method to construct the object under test.
- Reset shared state (singletons, notification observers) in `tearDown`. Prefer fakes over mocks for value objects.

## Anti-Patterns
- `id` returned from a factory - instead return `instancetype`.
- `NSString *str = [NSString stringWithFormat:@"%@", obj];` where concatenation suffices - instead use a literal.
- `if (x) { ... } else { ... }` after an early return - instead return early and drop the `else`.
- `self->_ivar` accessed from outside the class's own accessors - instead add a property or a private accessor. `@synthesize` for every property - instead let the compiler synthesise it.
- `[[MyClass alloc] init]` in an autorelease pool when `+new`/`+factory` exists - instead use the factory.
- An `NSError **` parameter that the method silently ignores - instead always populate it on failure.
- `if ([obj isKindOfClass:[Foo class]])` to branch on type - instead use a protocol or a polymorphic method.
- A property declared `assign` for an object - instead use `strong`, `weak`, or `copy` explicitly.

## Code Example
```objc
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/// Error domain for configuration loading failures.
extern NSErrorDomain const GHConfigurationErrorDomain;

/// Build a configuration object from a key=value document.
@interface GHConfiguration : NSObject

/// The parsed values, keyed by name.
@property (nonatomic, copy, readonly) NSDictionary<NSString *, NSString *> *values;

/// Creates a configuration from raw document text.
/// @param document The raw `key=value` document. May be nil.
/// @param error Populated with a description when parsing fails.
- (nullable instancetype)initWithDocument:(NSString *)document
                                     error:(NSError **)error;
@end

NS_ASSUME_NONNULL_END

@implementation GHConfiguration

- (nullable instancetype)initWithDocument:(NSString *)document
                                     error:(NSError **)error {
    self = [super init];
    if (self == nil) {
        return nil;
    }
    NSMutableDictionary<NSString *, NSString *> *values = [NSMutableDictionary dictionary];
    for (NSString *line in [document componentsSeparatedByString:@"\n"]) {
        NSRange separator = [line rangeOfString:@"="];
        if (separator.location == NSNotFound) {
            if (error != NULL) {
                *error = [NSError errorWithDomain:GHConfigurationErrorDomain code:1
                                         userInfo:@{NSLocalizedDescriptionKey: @"Malformed"}];
            }
            return nil;
        }
        values[[line substringToIndex:separator.location]] =
            [line substringFromIndex:separator.location + 1];
    }
    _values = [values copy];
    return self;
}
@end
```

## Sources
- https://github.com/github/objective-c-style-guide
- https://github.com/google/styleguide/blob/gh-pages/objcguide.md
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/CodingGuidelines/
- http://tomdoc.org/
