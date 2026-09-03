/* Kindergarten banks. Language kept short and concrete; numbers stay small
   enough to work out with fingers or counters. */
export const K_BANKS = {
"k-count": [
{sec:"N",type:"in",q:"What number comes right after 7?",ans:8,hint:"Count on from 7.",
 expl:"Counting up: 6, 7, then 8. So 8 comes right after 7."},
{sec:"N",type:"in",q:"What number comes right after 15?",ans:16,hint:"Count on from 15.",
 expl:"After 15 comes 16."},
{sec:"N",type:"mc",q:"Which number is missing?  4, 5, __, 7",mono:true,opts:["6","8","3","9"],a:0,
 expl:"Counting 4, 5, 6, 7 — the missing number is 6."},
{sec:"N",type:"in",q:"How many is 10 and 1 more?",ans:11,hint:"Count on one from 10.",
 expl:"One more than 10 is 11."},
{sec:"N",type:"mc",q:"Which number is missing?  17, 18, __, 20",mono:true,opts:["19","16","21","15"],a:0,
 expl:"Counting 17, 18, 19, 20 — the missing number is 19."},
{lvl:2,sec:"N",type:"in",q:"What number comes right after 29?",ans:30,hint:"A new ten begins.",
 expl:"After 29 the next ten starts, so it is 30."},
{lvl:2,sec:"N",type:"order",q:"Put these numbers in order, smallest first.",
 items:["12","8","20","15"],ansOrder:["8","12","15","20"],
 expl:"Counting up: 8, then 12, then 15, then 20."},
{lvl:3,sec:"N",type:"in",q:"Start at 10 and count on 5 more. Where do you land?",ans:15,
 hint:"11, 12, 13...",expl:"10, then 11, 12, 13, 14, 15. You land on 15."}
],

"k-countback": [
{sec:"N",type:"in",q:"What number comes right before 9?",ans:8,hint:"Count back one.",
 expl:"Counting back from 9 gives 8."},
{sec:"N",type:"in",q:"Count back: 20, 19, 18, __",ans:17,expl:"Counting back one from 18 gives 17."},
{sec:"N",type:"mc",q:"Which number is missing?  12, 11, __, 9",mono:true,opts:["10","13","8","7"],a:0,
 expl:"Counting back 12, 11, 10, 9 — the missing number is 10."},
{lvl:2,sec:"N",type:"in",q:"Start at 15 and count back 3. Where do you land?",ans:12,
 hint:"14, 13...",expl:"15, then 14, 13, 12. You land on 12."},
{lvl:2,sec:"N",type:"in",q:"A rocket counts down: 10, 9, 8, 7, __. What number comes next?",ans:6,
 hint:"Each number is one less.",expl:"After 7 comes 6 when counting back."},
{lvl:3,sec:"N",type:"order",q:"Put these in order, largest first.",
 items:["7","13","2","19"],ansOrder:["19","13","7","2"],
 expl:"Counting down: 19, then 13, then 7, then 2."}
],

"k-add10": [
{sec:"N",type:"in",q:"3 + 2 = ?",ans:5,hint:"Hold up 3 fingers, then 2 more.",
 expl:"3 and 2 more makes 5."},
{sec:"N",type:"in",q:"4 + 4 = ?",ans:8,expl:"4 and 4 more makes 8. This one is a double."},
{sec:"N",type:"in",q:"6 + 1 = ?",ans:7,hint:"One more than 6.",expl:"Adding 1 just counts on once: 7."},
{sec:"N",type:"in",q:"5 + 3 = ?",ans:8,expl:"Start at 5 and count on 3: 6, 7, 8."},
{sec:"N",type:"mc",q:"Which makes 10?",mono:true,opts:["7 + 3","7 + 2","6 + 3","8 + 4"],a:0,
 expl:"7 + 3 = 10. The others give 9, 9 and 12."},
{lvl:2,sec:"N",type:"in",q:"2 + 3 + 4 = ?",ans:9,hint:"Add two of them first.",
 expl:"2 + 3 = 5, then 5 + 4 = 9."},
{lvl:2,sec:"N",type:"multi",q:"Select EVERY pair that makes 8.",
 opts:["5 + 3","4 + 4","6 + 1","2 + 6"],aMulti:[0,1,3],
 expl:"5 + 3, 4 + 4 and 2 + 6 all make 8. 6 + 1 makes 7."},
{lvl:3,sec:"N",type:"in",q:"I have 4 apples. My friend gives me some more and now I have 9. How many did my friend give me?",
 ans:5,hint:"What do you add to 4 to reach 9?",expl:"4 + 5 = 9, so the friend gave 5 apples."}
],

"k-sub10": [
{sec:"N",type:"in",q:"7 − 2 = ?",ans:5,hint:"Start at 7 and count back 2.",
 expl:"7, then 6, 5. So 7 − 2 = 5."},
{sec:"N",type:"in",q:"9 − 4 = ?",ans:5,expl:"Counting back 4 from 9: 8, 7, 6, 5."},
{sec:"N",type:"in",q:"6 − 6 = ?",ans:0,hint:"Take away all of them.",
 expl:"Taking all 6 away leaves nothing, which is 0."},
{sec:"N",type:"in",q:"You have 8 grapes and eat 3. How many are left?",ans:5,
 expl:"8 − 3 = 5 grapes left."},
{lvl:2,sec:"N",type:"in",q:"10 − 4 = ?",ans:6,expl:"Counting back 4 from 10 gives 6."},
{lvl:2,sec:"N",type:"mc",q:"Which one leaves 3?",mono:true,opts:["8 − 5","9 − 5","7 − 5","6 − 2"],a:0,
 expl:"8 − 5 = 3. The others give 4, 2 and 4."},
{lvl:3,sec:"N",type:"in",q:"There were some birds on a branch. 3 flew away and 4 are left. How many were there at first?",
 ans:7,hint:"Put the ones that left back.",expl:"4 left plus the 3 that flew away makes 7 at the start."}
],

"k-evenodd": [
{sec:"N",type:"mc",q:"Is 6 even or odd?",opts:["Even","Odd"],a:0,
 expl:"6 counters pair up exactly with none left over, so 6 is even."},
{sec:"N",type:"mc",q:"Is 9 even or odd?",opts:["Odd","Even"],a:0,
 expl:"9 counters make 4 pairs with 1 left over, so 9 is odd."},
{sec:"N",type:"multi",q:"Select EVERY even number.",opts:["2","5","8","11","10"],aMulti:[0,2,4],
 expl:"2, 8 and 10 pair up exactly. 5 and 11 each leave one over."},
{lvl:2,sec:"N",type:"in",q:"Pip has 8 shoes. How many pairs of shoes is that?",ans:4,
 hint:"Two shoes make one pair.",expl:"8 shoes make 4 pairs, with none left over. That is why 8 is even."},
{lvl:2,sec:"N",type:"mc",q:"You have 7 socks. Can every sock find a partner?",
 opts:["No, one is left over","Yes, all of them"],a:0,
 expl:"7 is odd, so after 3 pairs there is 1 sock with no partner."},
{lvl:3,sec:"N",type:"mc",q:"Is the number of legs on 3 cats even or odd?",opts:["Even","Odd"],a:0,
 expl:"Each cat has 4 legs, so 3 cats have 12 legs. 12 pairs up exactly, so it is even."}
],

"k-2d": [
{sec:"G",type:"mc",q:"How many sides does a triangle have?",mono:true,opts:["3","4","5","2"],a:0,
 expl:"A triangle has 3 straight sides and 3 corners."},
{sec:"G",type:"mc",q:"How many corners does a square have?",mono:true,opts:["4","3","5","0"],a:0,
 expl:"A square has 4 corners and 4 sides, all the same length."},
{sec:"G",type:"mc",q:"Which shape has no straight sides at all?",opts:["Circle","Square","Triangle","Hexagon"],a:0,
 expl:"A circle is one curved line all the way round — no straight sides and no corners."},
{sec:"G",type:"mc",q:"How many sides does a hexagon have?",mono:true,opts:["6","5","7","4"],a:0,
 expl:"A hexagon has 6 sides. 'Hex' means six."},
{lvl:2,sec:"G",type:"multi",q:"Select EVERY shape that has 4 sides.",
 opts:["Square","Rectangle","Triangle","Rhombus"],aMulti:[0,1,3],
 expl:"Squares, rectangles and rhombuses all have 4 sides. A triangle has 3."},
{lvl:3,sec:"G",type:"in",q:"A triangle and a square are put side by side. How many corners are there altogether?",
 ans:7,hint:"Count each shape's corners, then add.",
 expl:"A triangle has 3 corners and a square has 4. Together that is 3 + 4 = 7."}
]
};
