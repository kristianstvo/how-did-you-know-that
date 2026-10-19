# Player model for timed 4-option trivia: research brief and simulation parameters

**Legend:** [M] measured in a source · [D] my arithmetic on measured data · [C] design or modelling convention · [I] my inference · **NF** = searched for and not found

## 1. Response-time shape and level
- **Right skew; lognormal is the standard model.** van der Linden's lognormal RT model fit adaptive ASVAB test data well, and a normal model could not reproduce the skew [M] (https://research.utwente.nl/en/publications/a-lognormal-model-for-response-times-on-test-items/). A 3-parameter lognormal with a minimum processing-time shift fits better on two datasets [M] (https://ifp.nyu.edu/2020/journal-article-abstracts/modeling-responses-and-response-times-in-tests-with-the-hierarchical-model-and-the-three-parameter-lognormal-distribution/).
- **Typical published σ for that model: NF.** I could not read the empirical tables of van der Linden 2006 or Klein Entink 2009. I did not use remembered values.
- **Kahoot, 20 s limit** (116 nursing students, 10 questions) [M] (https://pmc.ncbi.nlm.nih.gov/articles/PMC6663014/):
  - Overall mean RT 7.36 s, SD 5.41.
  - Per-question means range from 4.71 s to 9.03 s.
- **What that implies** [D], using the lognormal moment conversion:
  - Pooled σ ≈ 0.66 and median ≈ 5.9 s.
  - Per-question σ is 0.56–0.70 and per-question medians are about 3.7–7.6 s.
  - The 20 s cap shortens the tail, so true σ is probably a bit higher [I].
  - Spread of question mean RTs in log units ≈ 0.2 (item time-intensity SD).
- **Reading time.** Our spec times answers from question display, so reading is included. Average silent reading speed is 238 wpm (range 175–300) [M] (https://gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf). A question plus 4 options is about 25 words, or roughly 6 s for a full read. Players skim, so I set the floor (shift) at about 1 s [I].

## 2. Speed vs accuracy
- **Wrong answers are slower:**
  - Kahoot: in 17 of 21 quiz modules (4,640 answers), with a small-to-moderate effect [M] (https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2024.1412954/text).
  - Physics concept questions: incorrect answers took longer, and lower confidence went with longer RT [M] (https://mazur.harvard.edu/publications/response-times-conceptual-questions).
  - A general-knowledge review reaches the same conclusion [M] (https://newiipdm.haifa.ac.il/wp-content/uploads/2015/05/2008-Koriat-JEPLMC.pdf).
- **The effect within a single question is modest.** In the Kahoot nursing study, correctness and RT correlated significantly on only 1 of 10 questions [M].
- **Very fast answers are not all correct.** In an adaptive practice system, very fast answers mixed solid knowledge with pure guessing. Accuracy peaked at the 10th–20th RT percentile, and slow answers indicated weak knowledge [M] (https://www.educationaldatamining.org/EDM2015/proceedings/poster562-563.pdf). This is why the model needs a separate rapid-guess component.
- **Harder questions take longer:**
  - Item difficulty and time intensity correlated at ρ = .65 in a computerized adaptive testing study [M] (https://ris.utwente.nl/ws/files/5129699/Linden05hierarchical.pdf).
  - Across the 10 Kahoot questions, question accuracy and mean RT correlated at r ≈ −0.40 [D].

## 3. Accuracy by difficulty
- **OpenTDB easy/medium/hard mapped to human accuracy: NF.** The labels look like submitter tags, not calibrated difficulty [I] (https://opentdb.com).
- **Mixed-difficulty question sets average about 61% correct:**
  - Kahoot: 61.1%, with questions ranging from 28.8% to 89.8% [M] (https://pmc.ncbi.nlm.nih.gov/articles/PMC6663014/).
  - Russian 4-option general-knowledge norms (103 adults, 500 items): about 0.61 [M] (https://pmc.ncbi.nlm.nih.gov/articles/PMC7554590/).
- **Jeopardy! share of clues with at least one correct response (2019–2023 seasons)** [M] (https://jometry.substack.com/p/mar-20-24-2023-the-processes):
  - Jeopardy round: 95–98% for $200 clues down to 75–84% for $1000 clues.
  - Double Jeopardy round: 66–77% for $2000 clues.
  - Per-player rates are about 71% at $200 and 45% at $1000 [D, by that author, assuming independence]. These are elite contestants answering free-recall, so this is only a ceiling proxy.
- **HQ Trivia:** "savage" questions typically eliminated 70% or more of players, i.e. fewer than 30% correct [M, press] (https://money.com/savage-hq-trivia-question-all-time/).
- **Guessing floor is 25% [C], but real guesses beat it.** Distractors are not chosen evenly: in the Russian norms, 66 items had one option nobody picked and 19 items had only two options ever picked [M]. I model informed guessing at about 0.28–0.33 [I].
- **Industry heuristic:** about 90% correct on the first question falling to 30–40% on the last [C] (https://woobox.com/articles/trivia-quiz-question-design).

## 4. Timeouts
- **No-answer rates under 10–20 s limits: NF.** I found none for Kahoot, Quizizz, HQ or classroom clickers.
- **Indirect evidence:** a 10 s-limited number-line game (not trivia) showed a pile-up of responses at the deadline [M] (https://www.stat.cmu.edu/~brian/463-663/project-part-one/project-part-one-example-sols.pdf).
- **Model:** most players who reach the deadline tap a last-second guess. Treat timeout rate as a sweep parameter of 1–5% [I].

## 5. Individual differences
- **Convention:** IRT person ability is θ ~ N(0, 1) [C].
- **Data:** Russian true/false norms (145 young adults, 500 items) report per-person accuracy SD of 0.06–0.07 [M] (https://pmc.ncbi.nlm.nih.gov/articles/PMC11057714). The paper does not explicitly say this is between-person SD. Converted, it is about 0.55 logit on P(know), but averaging over items shrinks that [D/I].
- **Recommendation:** logit SD 0.8, sweep 0.5–1.2 [I].
- **Speed vs ability:** in Kahoot modules, players with higher overall RT had lower overall accuracy [M] (Liang 2024, above). Correct answers being faster already produces this, so the extra latent speed–ability correlation is set to 0 (sweep 0 to +0.4) [I].

## 6. Current bot vs this model
- **Current bot** (`C:\Users\km099\Desktop\How Did You Know That\client\src\engine.ts:251` and `:376`):
  - P(correct) is 0.65 / 0.45 / 0.28 by tier.
  - RT is uniform from 1.8 s to about 10.05 s.
  - There is no skew, no link between speed and correctness, no timeouts and no differences between players.
- **Consequences:**
  - Easy-tier accuracy is below the data.
  - Sub-1.8 s "answered in 1.2 s" evidence can never occur.
  - "Everyone missed" and "only one person got it" frequencies will be off.
- **Simulation recipe** [I]:
  - Each player draws `abilityLogit ~ N(0, 0.8)` and `speedLog ~ N(0, 0.25)`. Each question draws a time-intensity offset `~ N(0, 0.2)`.
  - `P(know) = logistic(logit(k_tier) + abilityLogit)`.
  - RT = 1 s shift + lognormal. The medians below are totals, so subtract the 1 s shift before sampling.
  - 10% of non-knowers are rapid guessers.
  - If RT goes past 15 s: 60% tap a guess at 13.5–14.9 s, otherwise it is a timeout.

## Confidence summary
- **Medium:** right-skew/lognormal shape; wrong answers slower; overall medians of about 5–7 s; σ of about 0.55–0.7.
- **Low:** per-tier accuracy, timeout rates, ability SD.

```json
{"rt_model":"shifted_lognormal","shift_s":{"value":1.0,"low":0.5,"high":1.5,"conf":"low","basis":"I; 3PLN fit + reading rate"},
"tiers":{
 "easy":{"p_know":{"value":0.80,"low":0.65,"high":0.92},"p_correct_implied":0.86,"knower_median_s":{"value":3.8,"low":3.0,"high":5.0},"guesser_median_s":{"value":6.5,"low":5.0,"high":8.5},"timeout_rate":{"value":0.01,"low":0.0,"high":0.03},"conf":"low"},
 "medium":{"p_know":{"value":0.50,"low":0.30,"high":0.65},"p_correct_implied":0.64,"knower_median_s":{"value":4.5,"low":3.5,"high":6.0},"guesser_median_s":{"value":7.5,"low":6.0,"high":9.5},"timeout_rate":{"value":0.02,"low":0.005,"high":0.05},"conf":"low-med"},
 "hard":{"p_know":{"value":0.22,"low":0.08,"high":0.40},"p_correct_implied":0.44,"knower_median_s":{"value":5.5,"low":4.0,"high":7.0},"guesser_median_s":{"value":8.5,"low":7.0,"high":11.0},"timeout_rate":{"value":0.04,"low":0.01,"high":0.08},"conf":"low"}},
"sigma_log":{"knower":{"value":0.50,"low":0.35,"high":0.65},"guesser":{"value":0.45,"low":0.30,"high":0.60},"pooled_target":{"value":0.65,"low":0.55,"high":0.75},"conf":"med","basis":"D from Kahoot PMC6663014"},
"guess_accuracy":{"value":0.28,"low":0.25,"high":0.33,"conf":"med","basis":"C floor 0.25 + M uneven distractor picks"},
"rapid_guess":{"share_of_nonknowers":{"value":0.10,"low":0.03,"high":0.20},"median_s":{"value":2.0,"low":1.4,"high":2.8},"sigma_log":0.30,"conf":"low"},
"deadline_behavior":{"timer_s":15,"p_last_second_tap_if_over":{"value":0.6,"low":0.3,"high":0.9},"tap_window_s":[13.5,14.9],"conf":"low"},
"person":{"ability_logit_sd":{"value":0.8,"low":0.5,"high":1.2,"conf":"low"},"speed_log_sd":{"value":0.25,"low":0.15,"high":0.35,"conf":"low"},"speed_ability_corr":{"value":0.0,"low":0.0,"high":0.4,"conf":"low"}},
"item_time_intensity_sd_log":{"value":0.20,"low":0.10,"high":0.30,"conf":"med","basis":"D Kahoot item means 4.7-9.0s"},
"not_found":["OpenTDB tier->human accuracy","timeout rates 10-20s","published lognormal sigma values (vdL 2006 tables unreadable)"]}
```