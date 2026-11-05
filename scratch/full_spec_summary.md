## Page 1
1 ===
AI Automation Opportunity Report 4 
Prepared for: Jeffway Construction Ltd    Prepared by: Cybix    Date: 23 March 2026 
 
1. Overview 
This report provides a definitive, fully-scoped breakdown of the AI-powered automation opportunity for 
Jeffway Construction Ltd, specifically focusing on the electrical estimating, commercial tracking, and 
labour processing lifecycle. The purpose of this document is to detail, in black and white, every step, 
trigger, and action that will be built, ensuring complete clarity on the solution being delivered. This 
automation is designed to act as a digital estimator and commercial assistant within your existing 
infrastructure, seamlessly connecting your tender documents, supplier quotes, EQUE2 payroll system, 
Monday.com pipeline, and financial tracking spreadsheets. 
The primary business objective is to eliminate the significant administrative burden which currently 
consumes the commercial and estimating teams, introduces pricing risks, and creates blind spots in 
project profitability. By automating the repetitive, rules-based tasks of drawing takeoffs from complex 
46-page architectural packs, multi-supplier price comparisons, PDF timesheet processing, and material 
invoice checking, we will unlock substantial value, improve estimating accuracy, and ensure that every 
project's profitability is protected from the tender stage right through to final completion. 
Mini Report Note 
I will add this is just a mini report, as there are a
...

## Page 2
2 ===
operatives, check them against allowed budgets per fix stage, enter the data into EQUE2, and 
painstakingly review hundreds of supplier invoice line items to catch overcharges or missing discounts. 
This manual dependency creates a cascade of further inefficiencies: 
●​ Estimating Bottlenecks & Capacity Constraints: The time-intensive nature of manual drawing 
takeoffs means estimators spend hours counting symbols on architectural elevations and floor plans 
rather than strategising on pricing or negotiating better rates. This limits the volume of tenders the 
business can accurately process. 
●​ Margin Erosion through Pricing Errors: Manually comparing supplier quotes across six different 
spreadsheet formats and tracking volatile material prices leaves room for human error. Furthermore, 
when suppliers fail to apply agreed discounts on their monthly invoices, the manual checking process 
often misses these discrepancies, leading to direct financial loss. 
●​ Labour Tracking Inaccuracies: Processing handwritten PDF timesheets manually and 
cross-referencing them against the complex labour tab (which splits pricing across 10 categories like 
Ducting, 1st Fix, Finals, and EV Chargers) is highly prone to error. Operatives using inconsistent 
wording or claiming for plots that have already been paid can easily slip through, resulting in 
overpayments and skewed project profitability data. 
●​ Lack of Performance Visibility: Because the data is locked in disparate spreadshe
...

## Page 3
3 ===
Room 
Recessed 
Downlights 
(R) 
Ceiling 
Pendants 
Double 
Sockets 
Single 
Sockets 
Light 
Switches 
DP Switches 
($) 
Cooker 
Switch ($$) 
Living Room 
14 
1 
5 
0 
2 
0 
0 
Kitchen 
0 
3 
4 
0 
2 
2 
1 
Bedroom 1 
0 
1 
3 
0 
1 
0 
0 
Bedroom 2 
2 
1 
3 
0 
2 
0 
0 
Bedroom 3 
2 
1 
2 
0 
1 
0 
0 
Study 
2 
1 
3 
0 
2 
1 
0 
WC (Main) 
1 
0 
1 
0 
1 
1 
0 
WC 
(En-suite) 
1 
0 
0 
0 
1 
0 
0 
Totals 
22 
8 
21 
0 
12 
4 
1 
 
Additional Items Detected: 
●​ 1x Consumer Unit / Distribution Board (top-left corridor entry point) 
●​ 6x Circuit wiring runs identified (colour-coded: lighting, ring main, cooker, shower, etc.) 
●​ Smoke / heat detector positions identified at key locations 
This output is exactly the data required to populate the specific house type tabs (e.g., Giganti, Crocus, 
Conte) in the Jeffway estimating spreadsheet. The AI reads the plan, counts the components, sections 
them by room, and produces a structured output that can be dropped directly into the existing workflow. 
 
4. Expected Impact & Quantifiable Value 
The implementation of this automation will deliver immediate, measurable, and substantial returns 
across your commercial operations. 
Area of Impact 
Benefit & Value Proposition 
Time Saving & Capacity Creation 
Estimators and commercial administrators will 
reclaim hundreds of hours per month currently 
spent counting symbols on 46-page drawing packs 
and transcribing handwritten timesheets into 
EQUE2. This time will be redirected to 
...

## Page 4
4 ===
Margin Protection & Cost Control 
Automated invoice checking ensures that every 
supplier overcharge, missed discount, or 
unauthorised purchase is immediately flagged. 
This directly protects project margins by 
preventing value leakage across the 130,000+ 
material lines processed annually. 
Enhanced Accuracy & Consistency 
Removing human data entry from the takeoff and 
timesheet allocation processes eliminates 
transcription errors, ensuring that tenders are 
perfectly accurate and operatives are paid 
correctly for the exact fix stage completed. 
Performance Analytics 
By digitising the timesheet and labour tracking 
process, the business gains instant visibility into 
operative performance, allowing management to 
identify inefficiencies and adjust future tender 
pricing accordingly. 
Accelerated Quoting Lifecycle 
The time from logging a tender to submitting a 
fully priced proposal will be dramatically reduced. 
Automated takeoffs and instant multi-supplier 
quote comparisons accelerate the entire 
estimating cycle. 
 
5. Implementation Notes 
Our investigation confirms that the core workflow relies on complex architectural PDF packs, handwritten 
PDF timesheets, and highly structured, multi-tab Excel spreadsheets. The automation will therefore be 
built using a two-step approach for document reading: a dedicated OCR engine (such as Google 
Document AI or Azure Document Intelligence) to extract the text first, then passing it to GPT-4o Vision for 
normalisation,
...

## Page 5
5 ===
Note: The investment figures detailed in Section 8 cover the design, build, and implementation of the 
automation. The ongoing API usage costs for the AI vision and OCR models are not included and will be 
billed as a running monthly operational cost based on usage volume. 
 
6. Full, Unabridged Automation Breakdown 
This section details every step the AI agent will perform. This is the definitive scope of work. 
Module 1: AI-Powered Electrical Plan Takeoff 
●​ Trigger: An estimator uploads a new tender pack (architectural PDFs and specifications) into a 
designated 'New Tenders' SharePoint folder, and the project is logged in the new build pipeline. 
●​ Step 1.1: Document Parsing & Page Identification: The agent scans the uploaded architectural packs 
(often 40+ pages per house type, including substructure plans, setting out plans, joists plans, roof 
plans, elevations, sections, and schedules). It intelligently identifies and extracts only the relevant 
floor plans (e.g., 'Ground Floor Setting Out', 'First Floor Setting Out') while ignoring elevations, roof 
truss details, staircase details, and substructure plans that do not contain electrical data. It also reads 
the cover sheet to identify the house type name, the applicable plots, the specification level (e.g., 
Lovell Gold, Lovell Silver, Shared Ownership, Rented), and whether the build is Masonry or Timber 
Frame. 
●​ Step 1.2: Symbol Key Detection: If the tender pack includes a symbol legend or key, the agent i
...

## Page 6
6 ===
●​ Step 1.6: Large Block Sectioning: For large-scale developments, the agent sections the communal 
takeoff into the standard Jeffway categories: Design, Prelims, Distribution, BNO Works, Containment, 
Small Power, and Lighting. Each section maps directly to the corresponding area in the Communals 
tab of the estimating spreadsheet. Within each section, the agent separates Materials (with 
quantities and costs) from Labour (with estimated hours and labour costs). 
●​ Step 1.7: Spreadsheet Population (House Type Tabs): The agent opens the Jeffway estimating 
template and populates the individual house type tabs (e.g., 'Giganti', 'Crocus', 'Conte', 'Lunaria', 
'Violet'). For each tab, it fills in the Qty, Manufacturer (defaulting to Deta where applicable), Part 
Number, Description, Unit Price (from historical data or left blank for supplier pricing), and Total 
columns. The structure follows the existing format: consumer units and MCBs first, then sockets, 
switches, light fittings, accessories, and specialist items. 
●​ Step 1.8: Spreadsheet Population (First Fix): The agent populates the master '1st Fix' tab with all 
cable quantities (e.g., 6242Y 2.5mm, 6242Y 1.5mm, SWA), back boxes (1-gang, 2-gang, circular), 
fixings, and sundries. These are categorised across the columns by house type, matching the existing 
47-column layout. 
●​ Step 1.9: Spreadsheet Population (Communals): For flat developments, the agent populates the 
'Communals' tab, filling in quantities acro
...

## Page 7
7 ===
●​ Step 2.2: Labour Calculation (Houses): For each house type, the agent calculates the base labour 
cost broken down by the 10 standard Jeffway categories: Ducting, 1st Fix, 2nd Fix, Finals & Heating, 
Fit Appliances, Weather Compensator, 20mm Condensate Pipe, Test, EV Charger, and Garages. The 
calculation is based on the total component count for that house type multiplied by the standard 
labour time, then multiplied by the agreed rate. 
●​ Step 2.3: Labour Calculation (Communal): For communal areas in flat developments, the agent 
calculates labour costs by section (Containment, Lighting, Small Power, Distribution, AOV, Door Entry, 
etc.), using the agreed hourly rate (e.g., £20/hour as per the existing Communals tab) multiplied by 
the estimated hours per section. It produces both a per-section cost and a total communal labour 
package figure. 
●​ Step 2.4: Historical Comparison: The agent compares the calculated labour price against actual costs 
from previous projects of similar size and complexity. If the calculated figure deviates significantly 
from historical actuals (e.g., the tender says £400 per 1st Fix for a Crocus but previous actuals 
averaged £450), the agent flags this for the estimator's attention with a clear recommendation. 
●​ Step 2.5: Markup Application: The agent applies the standard commercial markups to generate the 
final tender labour price. Based on the existing Jeffway structure, this includes the Labour Markup of 
26.5% (NI & Holidays),
...

## Page 8
8 ===
Templegate uses 15 columns including DATE, CODE, DESCRIPTION, QTY, PRICE, DISC, and SELL; Eddis 
& Walsall uses 7 columns; KEW uses 17 columns with separate Disc% and Value fields), the agent 
normalises all returns into a single, unified comparison structure. It validates that every line item has 
been priced and flags any gaps or items marked as 'not available'. 
●​ Step 3.4: Line-by-Line Comparison: The agent compares the unit prices line-by-line across all 
returned quotes. It produces a comparison matrix showing each item, the quoted prices from each 
supplier, and the percentage variance between them. 
●​ Step 3.5: Rebate & Net Cost Calculation: The agent factors in any known annual or quarterly rebates 
for each supplier (stored in the system and updated periodically). It calculates the true net cost per 
supplier after rebates are applied, which may change the ranking. 
●​ Step 3.6: Cable Price Volatility Check: For cable items specifically (which are known to fluctuate 
significantly), the agent compares the quoted prices against the last three months of cable pricing 
data from previous orders. If prices have moved significantly, it flags this to the estimator with a 
recommendation on whether to lock in now or wait. 
●​ Step 3.7: Best Package Recommendation: The agent identifies the most cost-effective supplier for 
the overall package and presents a summary showing the total cost from each supplier (pre- and 
post-rebate), along with a clear recommendation. 
...

## Page 9
9 ===
areas. The letter is drafted as a professional scope document that clearly communicates the value of 
the proposal. 
●​ Step 4.3: Inclusions Section: The agent drafts a detailed inclusions section listing everything Jeffway 
is allowing for in the tender: specific consumer unit types, socket specifications (e.g., Deta Slimline 
range), light fitting types, cable specifications, testing and certification, EV charging (if applicable), PV 
connections (if applicable), ASHP connections, and any specialist installations. This section is 
comprehensive enough that there is no ambiguity about what is covered. 
●​ Step 4.4: Exclusions & Qualifications: Based on the discrepancies flagged in Step 1.12 and standard 
company policy, the agent drafts the specific exclusions (items not included in the price) and 
qualifications (assumptions made, e.g., 'quotation based on specification Rev D dated [date]'). This 
protects Jeffway commercially by making the scope crystal clear. 
●​ Step 4.5: Tender Summary Sheet: The agent ensures the final 'Tender' summary tab in the 
spreadsheet is perfectly formatted for client submission, showing house types, plot counts, total 
value, cost per plot (with markups), materials per plot, and labour per plot. 
●​ Step 4.6: PDF Conversion & Storage: The agent saves the drafted Word document, converts a copy to 
PDF, and stores both alongside the final spreadsheet in the project's SharePoint folder, labelled as 
Revision A. 
●​ Step 4.7: Revision Manage
...

## Page 10
10 ===
operative. If the cell is already populated with another operative's initials, the agent flags this as a 
potential duplicate claim and generates an alert. 
●​ Step 5.5: Amount Verification: The agent compares the amount the operative is claiming against the 
agreed price-work value for that fix on that plot type (from the Labour Prices sheet generated in 
Module 2). If the operative is claiming more than the allowed amount, the agent flags the 
discrepancy. If they are claiming less (e.g., partial completion), the agent logs it as a partial claim. 
●​ Step 5.6: Day Work Handling: For operatives working on hourly rates or day rates (common on larger 
communal area installations and for apprentices), the agent extracts the hours claimed and verifies 
there is an accompanying daywork sheet reference. If no daywork reference exists for hourly work, 
the agent flags the item to be reverted back to the operative. Validated day work is logged against 
the communal labour budget rather than the plot-based labour tab. 
●​ Step 5.7: Discrepancy Report: For any line items that fail validation (duplicate claims, overcharges, 
unrecognised site codes, amount mismatches, missing daywork references), the agent compiles a 
discrepancy report and emails it to the finance team. Each flagged item includes the operative's 
name, employee reference, the claim details, and the specific reason for rejection. 
●​ Step 5.8: Labour Tab Population: For all validated claims, the agent inputs the
...

## Page 11
11 ===
●​ Step 6.1: Statement Ingestion & Normalisation: The agent ingests the Excel statement from the 
supplier using the same OCR-first approach as Module 5. Because each of the six suppliers uses 
different column formats (e.g., Templegate uses 15 columns with DATE, NUMBER, CODE, 
DESCRIPTION, QTY, PRICE, PER, DISC, SELL, SELLING, and ORDER REF; Eddis & Walsall uses 7 columns; 
KEW uses 17 columns with separate Disc% and Value fields; Medlock uses 9 columns), the agent 
normalises all formats into a standard structure. We will need sample statements from each supplier 
upfront to map the column structures before building the ingestion logic. 
●​ Step 6.2: Order Reference Parsing & Normalisation: The agent reads the order reference on each 
line item (e.g., '2145 11 LLANYRNEWYDD', '2226/STONEWOOD RETURN', 'TW NAILSEA', '2168 PV') 
and maps it to the correct project site code, plot number, and fix type. Where operatives or site 
foremen have used inconsistent formatting, the agent applies normalisation logic to resolve the 
reference. 
●​ Step 6.3: Project Spend Allocation: The agent allocates each line item to the correct project in the 
master Project Spend Tracker. It logs the material cost against the specific project, building a 
cumulative spend picture. 
●​ Step 6.4: Price Verification: The agent cross-references the charged unit price on each line item 
against the agreed tender price established with the chosen supplier in Module 3. If the supplier has 
charged a h
...

## Page 12
12 ===
giving the commercial team a real-time view of actual costs vs. tendered allowances for every live 
project. 
Module 7: Application Template Generation & Monthly Invoicing 
●​ Trigger: A project is confirmed as won and marked as 'Awarded' in the system. 
●​ Step 7.1: Application Template Creation: The agent takes the final tender revision spreadsheet and 
automatically generates the Main Application spreadsheet (e.g., 'JWES Main Contract Application'). It 
creates the SUMMARY tab with the Account Summary, the JWES Application tab with the formal 
interim application letter format, and the Main Application tab populated with every plot number, 
house type, and the agreed value per fix stage (1st Fix, 2nd Fix, Finals, Garages, Car Charging). 
●​ Step 7.2: Fix Stage Percentage Setup: The agent sets up the tracking columns for each fix stage, 
configuring the spreadsheet to track percentage completion (0 to 1) and monetary value claimed to 
date. The percentage split between fix stages is configurable and stored centrally. 
●​ Step 7.3: Communal Area Setup: For flat developments, the agent sets up the communal area 
section below the flat plots, with percentage-based claiming for each communal work package 
(Containment, Lighting, Small Power, Distribution, AOV, Door Entry, etc.). 
●​ Step 7.4: Variations Tab Setup: The agent creates the 'Variations to Contract' tab, pre-formatted with 
columns for Item number, Plot, Description, Order Number/Ref, Works Value, % Complete, 
...

## Page 13
13 ===
●​ Step 7.11: Invoice Generation: The agent generates the formal Interim Application letter (the 'JWES 
Application' tab), populating the FAO, project name, application number, application date, period 
ending date, order number, Forecast Final Account, Contract Works value, Extras/Variations value, 
Gross Application, Less Paid to Date, and Net Balance Due. This is formatted ready for submission to 
the client. 
 
7. Training and Handover 
Upon completion of the build, we will conduct a full training and handover session. This is not about 
learning a new system, but about learning how to work with your new digital commercial assistant. We 
will cover: 
●​ How to structure and upload architectural drawing packs into the SharePoint folder to ensure the AI 
vision model extracts data perfectly, including best practices for file naming and folder organisation. 
●​ How to review and approve the AI's takeoff output before it feeds into the pricing stages, including 
how to spot-check quantities and override where needed. 
●​ How to manage the human-in-the-loop checkpoints, specifically reviewing the AI's suggested labour 
pricing and using the supplier negotiation flags to secure better deals. 
●​ How to review the automated discrepancy reports for handwritten timesheets and supplier invoices, 
and how to action the exception items efficiently. 
●​ Best practices for standardising operative timesheet submissions to ensure maximum OCR processing 
accuracy, and how the data 
...
