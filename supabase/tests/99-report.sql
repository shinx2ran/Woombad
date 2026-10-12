-- Prints every failed check and one summary line; errors out (non-zero psql exit) if anything failed.
\set ON_ERROR_STOP on
\pset footer off
select suite, grp, descr, expected, actual from zz.results where not pass order by n;
select suite, count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed
from zz.results group by suite order by suite;
\pset tuples_only on
select format('RESULT passed=%s failed=%s', count(*) filter (where pass), count(*) filter (where not pass)) from zz.results;
\pset tuples_only off
do $$ begin
  if not exists (select 1 from zz.results) then raise exception 'no checks ran'; end if;
  if exists (select 1 from zz.results where not pass) then raise exception 'some checks failed'; end if;
end $$;
