       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYROLL.
       AUTHOR. LEGACY-SYSTEMS-TEAM.
      *----------------------------------------------------------------*
      * WEEKLY PAYROLL: GROSS PAY WITH OVERTIME, TIERED TAX, NET PAY.   *
      *----------------------------------------------------------------*
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-EMPLOYEE-COUNT       PIC 9(2)     VALUE 4.
       01  WS-INDEX                PIC 9(2)     VALUE 1.
       01  WS-EMPLOYEE-TABLE.
           05  WS-EMPLOYEE OCCURS 4 TIMES.
               10  WS-EMP-NAME     PIC X(20).
               10  WS-EMP-HOURS    PIC 9(3)V9.
               10  WS-EMP-RATE     PIC 9(3)V99.
       01  WS-OVERTIME-HOURS       PIC 9(3)V9   VALUE ZERO.
       01  WS-GROSS-PAY            PIC 9(6)V99  VALUE ZERO.
       01  WS-TAX-RATE             PIC V999     VALUE ZERO.
       01  WS-TAX                  PIC 9(6)V99  VALUE ZERO.
       01  WS-NET-PAY              PIC 9(6)V99  VALUE ZERO.
       01  WS-TOTAL-NET            PIC 9(7)V99  VALUE ZERO.
       01  WS-OVERTIME-FLAG        PIC X        VALUE 'N'.
           88  OVERTIME-WORKED                  VALUE 'Y'.
           88  NO-OVERTIME                      VALUE 'N'.
       01  WS-AUDIT-COUNT          PIC 9(3)     VALUE ZERO.

       PROCEDURE DIVISION.
       MAIN-PROCEDURE.
           PERFORM LOAD-EMPLOYEES
           PERFORM PROCESS-EMPLOYEE
               VARYING WS-INDEX FROM 1 BY 1
               UNTIL WS-INDEX > WS-EMPLOYEE-COUNT
           DISPLAY 'TOTAL NET PAYROLL: ' WS-TOTAL-NET
           STOP RUN.

       LOAD-EMPLOYEES.
           MOVE 'ALICE JOHNSON'  TO WS-EMP-NAME(1)
           MOVE 42.5             TO WS-EMP-HOURS(1)
           MOVE 28.75            TO WS-EMP-RATE(1)
           MOVE 'BOB MARTINEZ'   TO WS-EMP-NAME(2)
           MOVE 38.0             TO WS-EMP-HOURS(2)
           MOVE 31.20            TO WS-EMP-RATE(2)
           MOVE 'CAROL NGUYEN'   TO WS-EMP-NAME(3)
           MOVE 50.0             TO WS-EMP-HOURS(3)
           MOVE 45.00            TO WS-EMP-RATE(3)
           MOVE 'DAVID OKAFOR'   TO WS-EMP-NAME(4)
           MOVE 20.0             TO WS-EMP-HOURS(4)
           MOVE 18.50            TO WS-EMP-RATE(4).

       PROCESS-EMPLOYEE.
           PERFORM COMPUTE-GROSS-PAY
           PERFORM COMPUTE-TAX
           COMPUTE WS-NET-PAY = WS-GROSS-PAY - WS-TAX
           ADD WS-NET-PAY TO WS-TOTAL-NET
           IF OVERTIME-WORKED
               DISPLAY WS-EMP-NAME(WS-INDEX) ' NET: ' WS-NET-PAY
                   ' (OVERTIME)'
           ELSE
               DISPLAY WS-EMP-NAME(WS-INDEX) ' NET: ' WS-NET-PAY
           END-IF.

       COMPUTE-GROSS-PAY.
           IF WS-EMP-HOURS(WS-INDEX) > 40
               SET OVERTIME-WORKED TO TRUE
               COMPUTE WS-OVERTIME-HOURS = WS-EMP-HOURS(WS-INDEX) - 40
               COMPUTE WS-GROSS-PAY =
                   (40 * WS-EMP-RATE(WS-INDEX)) +
                   (WS-OVERTIME-HOURS * WS-EMP-RATE(WS-INDEX) * 1.5)
           ELSE
               SET NO-OVERTIME TO TRUE
               COMPUTE WS-GROSS-PAY =
                   WS-EMP-HOURS(WS-INDEX) * WS-EMP-RATE(WS-INDEX)
           END-IF.

       COMPUTE-TAX.
           EVALUATE TRUE
               WHEN WS-GROSS-PAY > 2000
                   MOVE 0.300 TO WS-TAX-RATE
               WHEN WS-GROSS-PAY > 1000
                   MOVE 0.200 TO WS-TAX-RATE
               WHEN OTHER
                   MOVE 0.100 TO WS-TAX-RATE
           END-EVALUATE
           COMPUTE WS-TAX ROUNDED = WS-GROSS-PAY * WS-TAX-RATE.

       PRINT-AUDIT-TRAIL.
           ADD 1 TO WS-AUDIT-COUNT
           DISPLAY 'AUDIT RECORD ' WS-AUDIT-COUNT.
