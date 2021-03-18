# Safe Math Standards Proposal
Due to Solidity's type system (or lack thereof, as it were), I propose that standards be set for how the project deals with safe arithmetic operations to prevent incorrect or unexpected results from leaking into monied transactions. This is particularly important for Solidity code compiled prior to revision v0.8.0, as native arithmetic operators prior to that revision silently overflow/underflow. 

These recommendations (in no particular order) were made based upon the very good series of articles located at [Math In Solidity](https://medium.com/coinmonks/math-in-solidity-part-1-numbers-384c8377f26d).

## Use Native Types Where Possible
Use `uint` or `int` data types and avoid the use of smaller types when masking is not directly required. All `uintx` and `intx` types are compiled to native 256 byte values by the EVM, and the most significant bits are masked, which needlessly takes additional operations and gas.

Example:<br>
```js
for (uint i = 0; i < 5; i++) {}
```
Clearly, `uint8` could be used here, but it saves no space and takes extra gas to compute<br>
(TODO: Show opcode differences to illustrate?).

## Use Native Arithmetic Operators Only In Specific Cases
It is permissible to use native arithmetic operators for such things as indexes, counters, or buffer sizes, i.e. for values limited by the size of data being processed. However, a comment should be place above each location that indicates positive confirmation that no overflow or underflow could occur. This will enable security audits to proceed more quickly if auditors recognize that developers were required to consider Solidity limitations for each computation.

Example:<br>
```js
// Permissible use: i cannot overflow

for (uint i = 0; i < 5; i++) {}
```

## Otherwise, Use `SafeMath`
There is no current need yet identified that requires data types greater than 256 bits in length. If one were to arise, a new library would be required that would also require consideration of safe operations. Presently, monied computations should be protected with SafeMath library calls, which revert on overflow/underflow.

Example:<br>
```js
// Do not do...
function transfer(uint storage _source, uint storage _dest, uint _amount) public returns (bool) {
  _source -= _amount;
  _dest += _amount;
  return true;
}

// Do this instead...
function transfer(uint storage _source, uint storage _dest, uint _amount) public returns (bool) {
  // Attach SafeMath library to uint type
  using SafeMath for uint;
  // Use SafeMath methods for arithmetic
  _source = _source.sub(_amount);
  _dest = _dest.add(_amount);
  return true;
}
```
TODO: Show running test examples of differences

## Avoid Phantom Overflows When Calculating Percentages
The `SafePct` library contains a function to calculate percentages in the form 
```
(x * p) / 100
(p * x) / 100
(x / 100) * p
(p / 100) * x
```
called `mulDiv`. Phantom overflows, or intermediate overflows, can occur as part of a percentage calculation even when the final result will fit in target type.

Example:<br>
```js
// Do not do...
function pctOf(uint _value, uint _pct) public returns (uint) {
  return (_value * _pct) / 100;
}

// Do this instead...
function pctOf(uint _value, uint _pct) public returns (uint) {
  // Attach SafePct library to uint type
  using SafePct for uint;

  return _value.mulDiv(_pct, 100);
}
```

## Casting
Down casting from uint/int does not revert on overflow, nor does int/uint casting revert for negative values, opening up code to a variety of vulnerabilities. The `SafeCast` library contains safe down and sign casting functions which will assert on unsafe behavior. If this library is not used on  such casts, code must contain a comment justifying unsafe use.

Example:<br>
```js
// Do not do this...
uint haveUnsignedValue = 0;
int needSignedValue = (int) haveUnsignedValue;

// Do this instead...
using SafeCast for uint;
uint haveUnsignedValue = 0;
int needSignedValue = haveUnsignedValue.toInt256();
```