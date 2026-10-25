# Analytics Schema

Table: analytics.refresh_log

## Notes

-   This table has no foreign-key constraints in the supplied SQL. The
    diagram shows the declared columns and primary key only.

## ER Diagram

``` mermaid
erDiagram
    ANALYTICS_REFRESH_LOG {
        bigint refresh_id PK
        text view_name
        timestamptz started_at
        timestamptz finished_at
        text status
        uuid triggered_by
        character error_sqlstate
    }
```
