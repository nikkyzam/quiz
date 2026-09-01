/* Grades 1 and 2. */
export const G12_BANKS = {
"g1-add20": [
{sec:"N",type:"in",q:"8 + 5 = ?",ans:13,hint:"Make ten first: 8 + 2 = 10.",
 expl:"Split the 5 into 2 and 3. 8 + 2 = 10, then 10 + 3 = 13."},
{sec:"N",type:"in",q:"9 + 6 = ?",ans:15,hint:"Make ten first.",
 expl:"9 + 1 = 10, and 5 remains, so 10 + 5 = 15."},
{sec:"N",type:"in",q:"7 + 7 = ?",ans:14,expl:"A double: 7 + 7 = 14."},
{sec:"N",type:"in",q:"12 + 4 = ?",ans:16,expl:"Count on 4 from 12: 13, 14, 15, 16."},
{sec:"N",type:"mc",q:"Which one makes 20?",mono:true,opts:["13 + 7","13 + 6","12 + 7","14 + 5"],a:0,
 expl:"13 + 7 = 20. The others give 19, 19 and 19."},
{lvl:2,sec:"N",type:"in",q:"6 + 7 + 4 = ?",ans:17,hint:"Look for a pair that makes ten.",
 expl:"6 + 4 = 10 first, then 10 + 7 = 17. Reordering makes it easier."},
{lvl:2,sec:"N",type:"multi",q:"Select EVERY sum that equals 15.",
 opts:["8 + 7","9 + 6","7 + 9","10 + 4"],aMulti:[0,1],
 expl:"8 + 7 = 15 and 9 + 6 = 15. But 7 + 9 = 16 and 10 + 4 = 14."},
{lvl:3,sec:"N",type:"in",q:"Ana has 9 stickers. Ben has 4 more than Ana. How many do they have altogether?",
 ans:22,hint:"Work out Ben's first.",
 expl:"Ben has 9 + 4 = 13. Together: 9 + 13 = 22 stickers."}
],

"g1-tensones": [
{sec:"N",type:"in",q:"How many tens are in 47?",ans:4,hint:"Look at the first digit.",
 expl:"47 is 4 tens and 7 ones, so there are 4 tens."},
{sec:"N",type:"in",q:"How many ones are in 63?",ans:3,expl:"63 is 6 tens and 3 ones."},
{sec:"N",type:"in",q:"What number is 5 tens and 2 ones?",ans:52,
 expl:"5 tens is 50, plus 2 ones makes 52."},
{sec:"N",type:"mc",q:"Which number has 8 tens?",mono:true,opts:["83","38","8","18"],a:0,
 expl:"83 is 8 tens and 3 ones. In 38 the 8 is the ones digit."},
{lvl:2,sec:"N",type:"in",q:"What number is 3 tens and 14 ones?",ans:44,
 hint:"14 ones is more than a ten.",
 expl:"14 ones is 1 ten and 4 ones, so altogether 4 tens and 4 ones — that is 44."},
{lvl:3,sec:"N",type:"in",q:"I am a two-digit number. My tens digit is 2 more than my ones digit, and my digits add to 10. What number am I?",
 ans:64,hint:"Which two digits add to 10 and differ by 2?",
 expl:"6 and 4 add to 10 and differ by 2. The tens digit is the bigger one, so the number is 64."}
],

"g2-arrays": [
{sec:"N",type:"in",q:"An array has 3 rows of 4. How many altogether?",ans:12,
 hint:"Add 4 three times, or count the rows.",expl:"3 rows of 4 is 4 + 4 + 4 = 12."},
{sec:"N",type:"in",q:"An array has 5 rows of 2. How many altogether?",ans:10,
 expl:"5 rows of 2 is 2 + 2 + 2 + 2 + 2 = 10."},
{sec:"N",type:"mc",q:"Which addition matches an array of 4 rows of 5?",mono:true,
 opts:["5 + 5 + 5 + 5","4 + 4 + 4 + 4 + 4","4 + 5","5 + 4 + 5"],a:0,
 expl:"4 rows of 5 means adding 5 four times: 5 + 5 + 5 + 5 = 20."},
{lvl:2,sec:"N",type:"in",q:"An array of counters has 4 rows and 6 in each row. How many counters?",ans:24,
 expl:"4 rows of 6 is 6 + 6 + 6 + 6 = 24."},
{lvl:2,sec:"N",type:"mc",q:"An array has 12 counters in 3 equal rows. How many are in each row?",
 mono:true,opts:["4","3","6","12"],a:0,expl:"12 shared into 3 equal rows gives 4 in each row."},
{lvl:3,sec:"N",type:"in",q:"A box holds 5 rows of 4 chocolates. Two chocolates are eaten. How many are left?",
 ans:18,hint:"Work out the whole box first.",
 expl:"5 rows of 4 is 20 chocolates. After eating 2, there are 18 left."}
],

"g2-place1000": [
{sec:"N",type:"in",q:"How many hundreds are in 372?",ans:3,expl:"372 is 3 hundreds, 7 tens and 2 ones."},
{sec:"N",type:"in",q:"What number is 4 hundreds, 0 tens and 6 ones?",ans:406,
 hint:"The zero holds the tens place.",
 expl:"400 + 0 + 6 = 406. The 0 is important — without it you would write 46."},
{sec:"N",type:"mc",q:"Which number is the largest?",mono:true,opts:["519","591","195","159"],a:1,
 expl:"Compare hundreds first: 519 and 591 both have 5 hundreds. Then tens: 9 beats 1, so 591 is largest."},
{lvl:2,sec:"N",type:"order",q:"Put these in order, smallest first.",
 items:["408","480","84","840"],ansOrder:["84","408","480","840"],
 expl:"84 has no hundreds. Then 408, 480 and 840 compare by hundreds, then tens."},
{lvl:2,sec:"N",type:"in",q:"What is 10 more than 295?",ans:305,hint:"Watch the tens roll over.",
 expl:"295 + 10 = 305. The 9 tens become 10 tens, which makes a new hundred."},
{lvl:3,sec:"N",type:"in",q:"Using the digits 7, 2 and 5 once each, what is the largest three-digit number you can make?",
 ans:752,hint:"Put the biggest digit where it counts most.",
 expl:"The hundreds place matters most, so put 7 there, then 5, then 2: 752."}
]
};
