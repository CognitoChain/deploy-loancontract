pragma solidity ^0.4.19;

contract loan {
    address creator = msg.sender;
    uint256 totalRepaid = 0;
    uint256 principalAmount;
    uint256 TotalRepaymentDue;

    function getTotalRepaid() public view returns(uint256) {
        return totalRepaid;
    }

    event RepaymentEvent(
        uint256 amount,
        address contract_creator
    );
    enum Status {
        ACTIVE,
        CLOSED,
        DEFAULT,
        DEACTIVATED
    }
    Status public status;

    function init(uint256 principle , uint256 totalDue ) payable public returns (bool done) {
        principalAmount = principle;
        TotalRepaymentDue = totalDue;
        status = Status.ACTIVE;
        return true;
    }

    function makeRepayment(uint256 amount) payable public returns (uint256 _totalRepaid) {
        require(principalAmount > 0);
        require(TotalRepaymentDue > 0);
        totalRepaid = totalRepaid + amount;
        emit RepaymentEvent(amount, msg.sender);
        if ( totalRepaid >= TotalRepaymentDue) {
                status = Status.CLOSED;
            }
        return totalRepaid;
    }

    function getRemainingbalance() payable public returns (uint256 _totalDue) {
        require(principalAmount > 0);
        require(TotalRepaymentDue > 0);
        return (TotalRepaymentDue - totalRepaid);
    }
}