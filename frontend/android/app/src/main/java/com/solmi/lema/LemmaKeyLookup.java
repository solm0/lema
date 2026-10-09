package com.solmi.lema;

/** Checks whether a normalized lemma/POS pair exists in the installed pack. */
interface LemmaKeyLookup {
    boolean contains(String lemma, String pos);
}
