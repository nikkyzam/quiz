/* Grade 8. */
export const G8_BANKS = {
"g8-irrational": [
{sec:"N",type:"mc",q:"Which of these is IRRATIONAL?",mono:true,
 opts:["√2","4","1/2","0.75"],a:0,
 expl:"√2 cannot be written as a fraction of whole numbers — its decimal never ends or repeats."},
{sec:"N",type:"mc",q:"Which of these is RATIONAL?",mono:true,
 opts:["√9","√2","√3","π"],a:0,expl:"√9 = 3, a whole number, which is rational. The others are irrational."},
{sec:"N",type:"mc",q:"Is 0.333... (repeating forever) rational or irrational?",
 opts:["Rational","Irrational","Neither","Both"],a:0,
 expl:"A repeating decimal can always be written as a fraction (0.333... = 1/3), so it is rational."},
{sec:"N",type:"in",q:"What is √16?",ans:4,expl:"4 × 4 = 16, so √16 = 4."},
{sec:"N",type:"mc",q:"Which best describes π?",
 opts:["An irrational number","A whole number","A fraction","A repeating decimal"],a:0,
 expl:"π's decimal digits never end or repeat, which is the definition of irrational."},
{lvl:2,sec:"N",type:"mc",q:"√2 is approximately 1.41421356... Between which two whole numbers does √2 lie?",mono:true,
 opts:["1 and 2","0 and 1","2 and 3","1.4 and 1.5"],a:0,
 expl:"1² = 1 and 2² = 4, and 2 is between them, so √2 is between 1 and 2."},
{lvl:2,sec:"N",type:"in",q:"What is √49?",ans:7,expl:"7 × 7 = 49, so √49 = 7."},
{lvl:3,sec:"N",type:"mc",q:"Which sum is RATIONAL?",mono:true,
 opts:["√4 + √9","√2 + √3","π + 1","√2 + π"],a:0,
 expl:"√4 + √9 = 2 + 3 = 5, a whole number. The others combine irrational values that do not cancel out."}
],

"g8-radicals": [
{sec:"N",type:"in",q:"What is √25?",ans:5,expl:"5 × 5 = 25, so √25 = 5."},
{sec:"N",type:"in",q:"What is √64?",ans:8,expl:"8 × 8 = 64, so √64 = 8."},
{sec:"N",type:"mc",q:"Simplify: 2³ × 2²",mono:true,opts:["2⁵","2⁶","4⁵","2¹"],a:0,
 expl:"Multiplying powers with the same base adds the exponents: 3 + 2 = 5, so 2⁵."},
{sec:"N",type:"mc",q:"Simplify: (3²)³",mono:true,opts:["3⁶","3⁵","3⁹","6⁶"],a:0,
 expl:"Raising a power to a power multiplies the exponents: 2 × 3 = 6, so 3⁶."},
{sec:"N",type:"in",q:"What is 5⁻¹ written as a fraction, 1/__? Type just the denominator.",ans:5,
 expl:"A negative exponent flips it to a fraction: 5⁻¹ = 1/5."},
{lvl:2,sec:"N",type:"mc",q:"Simplify: 2⁴ ÷ 2²",mono:true,opts:["2²","2⁶","2⁸","1"],a:0,
 expl:"Dividing powers with the same base subtracts the exponents: 4 − 2 = 2, so 2²."},
{lvl:2,sec:"N",type:"in",q:"What is 4^(1/2), the square root of 4?",ans:2,
 expl:"A power of 1/2 means square root: 4^(1/2) = √4 = 2."},
{lvl:3,sec:"N",type:"mc",q:"Simplify: (2³)² ÷ 2²",mono:true,opts:["2⁴","2³","2⁸","2¹"],a:0,
 expl:"(2³)² = 2⁶, then 2⁶ ÷ 2² = 2⁴."}
],

"g8-linear": [
{sec:"P",type:"in",q:"Solve for x: 3x + 5 = 20",ans:5,expl:"20 − 5 = 15, and 15 ÷ 3 = 5."},
{sec:"P",type:"in",q:"Solve for x: 2(x − 4) = 10",ans:9,expl:"2x − 8 = 10, so 2x = 18 and x = 9."},
{sec:"P",type:"mc",q:"Which value of x solves 4x − 7 = 9?",mono:true,opts:["4","3","5","2"],a:0,
 expl:"4 × 4 − 7 = 16 − 7 = 9."},
{sec:"P",type:"in",q:"Solve for x: 5x − 3 = 3x + 9",ans:6,
 hint:"Get the x terms on one side first.",expl:"2x = 12, so x = 6."},
{sec:"P",type:"mc",q:"Which describes the solution to 2x + 6 = 2x + 6?",
 opts:["All real numbers (infinite solutions)","Only x equals zero exactly","There is no solution at all","Only x equals six exactly"],a:0,
 expl:"Both sides are identical for every x, so every real number is a solution."},
{lvl:2,sec:"P",type:"in",q:"Solve for x: 3(x + 2) = 2(x + 7)",ans:8,
 expl:"3x + 6 = 2x + 14, so x = 8."},
{lvl:2,sec:"P",type:"mc",q:"Which equation has NO solution?",mono:true,
 opts:["2x + 3 = 2x + 5","2x + 3 = 2x + 3","x + 3 = 5","2x = 6"],a:0,
 expl:"Subtracting 2x from both sides leaves 3 = 5, which is never true."},
{lvl:3,sec:"P",type:"in",q:"Solve for x: 4(x − 1) − 2x = 3x − 10",ans:6,
 hint:"Simplify the left side first.",
 expl:"4x − 4 − 2x = 2x − 4, so 2x − 4 = 3x − 10, giving x = 6."}
]
};
